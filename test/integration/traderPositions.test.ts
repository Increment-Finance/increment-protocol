import {expect} from 'chai';
import {BigNumber} from 'ethers';
import env, {ethers} from 'hardhat';

import {rDiv, rMul} from '../helpers/utils/calculations';
import {setup, createUABalance, User} from '../helpers/setup';
import {
  addUSDCCollateralAndUSDCBalanceToUsers,
  extendPositionWithCollateral,
  depositCollateralAndProvideLiquidity,
  withdrawCollateral,
} from '../helpers/PerpetualUtilsFunctions';

import {
  getCloseProposedAmount,
  getCloseTradeDirection,
  getProceedsFromClosingShortPosition,
  getTraderProfit,
  get_dy,
} from '../helpers/TradingGetters';

import {
  getLatestTimestamp,
  revertTimeAndSnapshot,
} from '../../helpers/misc-utils';
import {Side} from '../helpers/utils/types';
import {VBASE_INDEX, VQUOTE_INDEX, WAD} from '../../helpers/constants';
import {minutes} from '../../helpers/time';
import {ClearingHouseErrors, PerpetualErrors} from '../../helpers/errors';
import {tokenToWad} from '../../helpers/contracts-helpers';

import {LibPerpetual} from '../../typechain/contracts/Perpetual';

describe('Increment: open/close long/short trading positions', () => {
  let alice: User;
  let bob: User;
  let lp: User;
  let lpTwo: User;
  let deployer: User;
  let depositAmount: BigNumber; // with 1e18 decimals

  // protocol constants
  let insuranceFee: BigNumber;

  // deployment
  before('Get protocol constants', async () => {
    const {deployer} = await setup();

    insuranceFee = await deployer.perpetual.insuranceFee();
  });

  beforeEach(
    'Give Alice funds and approve transfer by the vault to her balance',
    async () => {
      ({alice, bob, lp, lpTwo, deployer} = await setup());

      depositAmount = await createUABalance([alice, bob, lp, lpTwo, deployer]);
      depositAmount = depositAmount.div(20);

      await alice.ua.approve(alice.vault.address, depositAmount);
    }
  );

  it('Should fail if the pool has no liquidity in it', async () => {
    await expect(
      alice.clearingHouse.extendPositionWithCollateral(
        0,
        depositAmount,
        alice.ua.address,
        depositAmount.div(10),
        Side.Long,
        0
      )
    ).to.be.revertedWith(''); // no error message by curve
  });

  it('Should fail if the amount is null', async () => {
    await expect(
      alice.clearingHouse.changePosition(0, 0, 0, Side.Long)
    ).to.be.revertedWith(ClearingHouseErrors.ChangePositionZeroArgument);
  });

  it('Should fail if the opened position openNotional is under the minimum allowed amount', async () => {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await depositCollateralAndProvideLiquidity(
      lp,
      lp.ua,
      depositAmount.mul(20)
    );

    await alice.clearingHouse.deposit(depositAmount.div(100), alice.ua.address);

    await expect(
      alice.clearingHouse.changePosition(
        0,
        depositAmount.div(100),
        0,
        Side.Short // Small Long positions will be auto-closed via sellBaseDust
      )
    ).to.be.revertedWith(ClearingHouseErrors.UnderOpenNotionalAmountRequired);
  });

  it('Should fail if user does not have enough funds deposited in the vault', async () => {
    await depositCollateralAndProvideLiquidity(
      deployer,
      deployer.ua,
      depositAmount.mul(20)
    );

    await alice.clearingHouse.deposit(depositAmount.div(5), alice.ua.address);

    // swap succeeds, then it fails when margin is checked
    await expect(
      alice.clearingHouse.changePosition(0, depositAmount.mul(20), 0, Side.Long)
    ).to.be.revertedWith(ClearingHouseErrors.ExtendPositionInsufficientMargin);
  });

  it('Should fail if user open too large of a position', async () => {
    await depositCollateralAndProvideLiquidity(
      deployer,
      deployer.ua,
      depositAmount.mul(20)
    );
    await depositCollateralAndProvideLiquidity(
      lp,
      lp.ua,
      depositAmount.mul(20)
    );
    await alice.clearingHouse.deposit(depositAmount.div(5), alice.ua.address);

    // swap succeeds, then fails with max position size error
    // @dev: margin requirements would not be met either later in the function call
    await expect(
      alice.clearingHouse.changePosition(0, depositAmount.mul(21), 0, Side.Long)
    ).to.be.revertedWith(PerpetualErrors.MaxPositionSize);
  });

  async function _openAndCheckPosition(
    direction: Side,
    expectedTokensBought: string,
    minAmount: BigNumber
  ) {
    // expected values
    const initialVaultBalance = await alice.vault.getReserveValue(
      alice.address,
      false
    );

    let positionSize: BigNumber, notionalAmount: BigNumber;
    if (direction === Side.Long) {
      notionalAmount = depositAmount.mul(-1);
      positionSize = BigNumber.from(expectedTokensBought);
    } else {
      notionalAmount = BigNumber.from(expectedTokensBought);
      positionSize = depositAmount.mul(-1);
    }
    const eInsuranceFee = rMul(notionalAmount.abs(), insuranceFee);
    const percentageFee = await alice.curveViews.get_dy_fees_perc(
      alice.market.address,
      direction == Side.Long ? VQUOTE_INDEX : VBASE_INDEX,
      direction == Side.Long ? VBASE_INDEX : VQUOTE_INDEX,
      depositAmount
    );
    const eTradingFee = rMul(notionalAmount.abs(), percentageFee);

    await expect(
      alice.clearingHouse.changePosition(0, depositAmount, minAmount, direction)
    )
      .to.emit(alice.clearingHouse, 'ChangePosition')
      .withArgs(
        0,
        alice.address,
        direction,
        notionalAmount,
        positionSize,
        eInsuranceFee.add(eTradingFee).mul(-1),
        true
      );

    const alicePosition = await alice.perpetual.getTraderPosition(
      alice.address
    );
    expect(alicePosition.positionSize).to.be.equal(positionSize);
    expect(alicePosition.openNotional).to.be.equal(notionalAmount);
    // cumFundingRate is set at 0 because there's no activity before in this test
    expect(alicePosition.cumFundingRate).to.be.equal(0);

    if (direction === Side.Long) {
      expect(alicePosition.positionSize).to.be.gte(minAmount);
    } else {
      expect(alicePosition.openNotional).to.be.gte(minAmount);
    }

    expect(
      alicePosition.openNotional.abs().div(ethers.utils.parseEther('0.01'))
    ).to.be.above(ethers.BigNumber.from('1'));

    const vaultBalanceAfterPositionOpened = await alice.vault.getReserveValue(
      alice.address,
      false
    );

    // note: fundingRate is null in this case
    const eNewVaultBalance = initialVaultBalance
      .sub(eInsuranceFee)
      .sub(eTradingFee);

    expect(eNewVaultBalance).to.eq(vaultBalanceAfterPositionOpened);
  }

  it('Should open LONG position', async () => {
    // set-up (needed for `getExpectedVBaseAmount` to work)
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await alice.clearingHouse.deposit(depositAmount, alice.ua.address);

    const expectedVBase =
      await alice.clearingHouseViewer.getExpectedVBaseAmount(0, depositAmount);
    const minVBaseAmount = rMul(expectedVBase, ethers.utils.parseEther('0.99'));

    const expectedVBaseBought = '439354433732566974907';
    await _openAndCheckPosition(Side.Long, expectedVBaseBought, minVBaseAmount);
  });

  it('Should open SHORT position', async () => {
    // set-up (needed for `getExpectedVQuoteAmount` to work)
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await alice.clearingHouse.deposit(depositAmount, alice.ua.address);

    const expectedVQuote =
      await alice.clearingHouseViewer.getExpectedVQuoteAmount(0, depositAmount);
    const minVQuoteAmount = rMul(
      expectedVQuote,
      ethers.utils.parseEther('0.99')
    );

    const expectedVQuoteBought = '564697859662072273343';
    await _openAndCheckPosition(
      Side.Short,
      expectedVQuoteBought,
      minVQuoteAmount
    );
  });

  it('Should work if trader opens position after having closed one', async () => {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount,
      Side.Long,
      0
    );

    const alicePosition = await alice.perpetual.getTraderPosition(
      alice.address
    );

    await alice.clearingHouse.changePosition(
      0,
      alicePosition.positionSize,
      0,
      getCloseTradeDirection(alicePosition)
    );

    // expected values
    const eInsuranceFee = rMul(depositAmount.abs(), insuranceFee);
    const percentageFee = await alice.curveViews.get_dy_fees_perc(
      alice.market.address,
      VQUOTE_INDEX,
      VBASE_INDEX,
      depositAmount
    );
    const eTradingFee = rMul(depositAmount.abs(), percentageFee);

    await expect(
      alice.clearingHouse.changePosition(0, depositAmount, 0, Side.Long)
    )
      .to.emit(alice.clearingHouse, 'ChangePosition')
      .withArgs(
        0,
        alice.address,
        Side.Long,
        depositAmount.mul(-1),
        '439357534240208349907', // very brittle
        eInsuranceFee.add(eTradingFee).mul(-1),
        true
      );
  });

  it('Should deposit collateral & open position then close position & withdraw collateral', async () => {
    // set-up
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    // deposit collateral & open position
    const percentageFeeOpen = await alice.curveViews.get_dy_fees_perc(
      alice.market.address,
      VQUOTE_INDEX,
      VBASE_INDEX,
      depositAmount
    );
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount,
      Side.Long,
      0
    );

    const alicePosition = await alice.clearingHouseViewer.getTraderPosition(
      0,
      alice.address
    );

    const eInsuranceFee = rMul(alicePosition.openNotional.abs(), insuranceFee);
    const eTradingFee = rMul(
      alicePosition.openNotional.abs(),
      percentageFeeOpen
    );
    const eCollateralAmount = depositAmount.sub(eInsuranceFee).sub(eTradingFee);

    const alicePositionCollateralAfterPositionOpened =
      await alice.vault.getReserveValue(alice.address, false);

    expect(alicePositionCollateralAfterPositionOpened).to.eq(eCollateralAmount);

    // close position & withdraw collateral
    const alicePositionSize = (
      await alice.perpetual.getTraderPosition(alice.address)
    ).positionSize;

    await alice.clearingHouse.closePositionWithdrawCollateral(
      0,
      alicePositionSize,
      0,
      alice.ua.address
    );

    const alicePositionCollateralAfterPositionClosed =
      await alice.vault.getReserveValue(alice.address, false);

    expect(alicePositionCollateralAfterPositionClosed).to.eq(0);
  });

  it('Trader should not be able to withdraw his collateral balance when doing so breaks the margin requirement of an open position', async function () {
    // setup
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount,
      Side.Long,
      0
    );

    const aliceUABalance = await alice.vault.getBalance(alice.address, 0);

    await expect(
      alice.clearingHouse.withdraw(aliceUABalance, alice.ua.address)
    ).to.be.revertedWith(ClearingHouseErrors.WithdrawInsufficientMargin);
  });

  async function _openPositionThenIncreasePositionWithinMarginRequirement(
    direction: Side
  ) {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    const traderPositionBeforeFirstTrade =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    expect(traderPositionBeforeFirstTrade.openNotional).to.eq(0);
    expect(traderPositionBeforeFirstTrade.positionSize).to.eq(0);
    expect(traderPositionBeforeFirstTrade.cumFundingRate).to.eq(0);

    // position is 10% of the collateral
    const eReceived1 = await alice.curveViews.get_dy_ex_fees(
      alice.market.address,
      direction == Side.Long ? 0 : 1,
      direction == Side.Long ? 1 : 0,
      depositAmount.div(10)
    );
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount.div(10),
      direction,
      0
    );

    // CHECK TRADER POSITION
    const traderPositionAfterFirstTrade =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    if (direction === Side.Long) {
      expect(traderPositionAfterFirstTrade.positionSize).to.eq(eReceived1);
      expect(traderPositionAfterFirstTrade.openNotional).to.eq(
        depositAmount.div(10).mul(-1)
      );
    } else {
      expect(traderPositionAfterFirstTrade.openNotional).to.eq(eReceived1);
      expect(traderPositionAfterFirstTrade.positionSize).to.eq(
        depositAmount.div(10).mul(-1)
      );
    }
    expect(traderPositionAfterFirstTrade.cumFundingRate).to.eq(0);

    const vaultBalanceAfterFirstTrade = await alice.vault.getReserveValue(
      alice.address,
      false
    );

    // change the value of global.cumFundingRate to force a funding rate payment when extending the position
    const anteriorTimestamp = (await getLatestTimestamp(env)) - 15;
    let newCumFundingRate;
    if (direction === Side.Long) {
      newCumFundingRate = ethers.utils.parseEther('0.1'); // set very large positive cumFundingRate so that LONG position is impacted negatively
    } else {
      newCumFundingRate = ethers.utils.parseEther('0.1').mul(-1); // set very large negative cumFundingRate so that SHORT position is impacted negatively
    }

    await alice.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
      anteriorTimestamp,
      newCumFundingRate
    );

    // total position is 20% of the collateral
    const eReceived2 = await alice.curveViews.get_dy_ex_fees(
      alice.market.address,
      direction == Side.Long ? VQUOTE_INDEX : VBASE_INDEX,
      direction == Side.Long ? VBASE_INDEX : VQUOTE_INDEX,
      depositAmount.div(10)
    );

    const percentageFee = await alice.curveViews.get_dy_fees_perc(
      alice.market.address,
      direction == Side.Long ? VQUOTE_INDEX : VBASE_INDEX,
      direction == Side.Long ? VBASE_INDEX : VQUOTE_INDEX,
      depositAmount.div(10)
    );
    await alice.clearingHouse.changePosition(
      0,
      depositAmount.div(10),
      0,
      direction
    );

    // CHECK TRADER POSITION
    const traderPositionAfterSecondTrade =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    if (direction === Side.Long) {
      expect(traderPositionAfterSecondTrade.positionSize).to.eq(
        traderPositionAfterFirstTrade.positionSize.add(eReceived2)
      );
      expect(traderPositionAfterSecondTrade.openNotional).to.eq(
        traderPositionAfterFirstTrade.openNotional.mul(2)
      );
    } else {
      expect(traderPositionAfterSecondTrade.positionSize).to.eq(
        traderPositionAfterFirstTrade.positionSize.mul(2)
      );
      expect(traderPositionAfterSecondTrade.openNotional).to.eq(
        traderPositionAfterFirstTrade.openNotional.add(eReceived2)
      );
    }

    const vaultBalanceAfterSecondTrade = await alice.vault.getReserveValue(
      alice.address,
      false
    );

    // expected vault after expansion of position

    let eUpcomingFundingRate;
    if (direction === Side.Long) {
      eUpcomingFundingRate = traderPositionAfterFirstTrade.cumFundingRate.sub(
        (await alice.perpetual.getGlobalPosition()).cumFundingRate
      );
    } else {
      eUpcomingFundingRate = (
        await alice.perpetual.getGlobalPosition()
      ).cumFundingRate.sub(traderPositionAfterFirstTrade.cumFundingRate);
    }
    const eFundingPayment = rMul(
      eUpcomingFundingRate,
      traderPositionAfterFirstTrade.positionSize.abs()
    );

    const addedOpenNotional = traderPositionAfterSecondTrade.openNotional
      .abs()
      .sub(traderPositionAfterFirstTrade.openNotional.abs());
    const eInsuranceFee = rMul(addedOpenNotional, insuranceFee);
    const eTradingFee = rMul(addedOpenNotional, percentageFee);
    // note: fundingRate is null in this case
    const eNewVaultBalance = vaultBalanceAfterFirstTrade
      .add(eFundingPayment)
      .sub(eInsuranceFee)
      .sub(eTradingFee);

    expect(eNewVaultBalance).to.be.closeTo(vaultBalanceAfterSecondTrade, 1);
    expect(vaultBalanceAfterSecondTrade).to.lt(vaultBalanceAfterFirstTrade);

    const proposedAmount = await getCloseProposedAmount(
      traderPositionAfterSecondTrade,
      alice.market,
      alice.curveViews
    );

    if (direction === Side.Long) {
      await alice.clearingHouse.changePosition(
        0,
        proposedAmount,
        0,
        getCloseTradeDirection(traderPositionAfterSecondTrade)
      );
    } else {
      await alice.clearingHouse.changePosition(
        0,
        proposedAmount,
        0,
        getCloseTradeDirection(traderPositionAfterSecondTrade)
      );
    }

    // CHECK TRADER POSITION
    const traderPositionAfterClosingPosition =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    expect(traderPositionAfterClosingPosition.openNotional).to.eq(0);
    expect(traderPositionAfterClosingPosition.positionSize).to.eq(0);
    expect(traderPositionAfterClosingPosition.cumFundingRate).to.eq(0);
  }

  it('Should increase LONG position size if user tries to and his collateral is sufficient', async () => {
    await _openPositionThenIncreasePositionWithinMarginRequirement(Side.Long);
  });

  it('Should increase SHORT position size if user tries to and his collateral is sufficient', async () => {
    await _openPositionThenIncreasePositionWithinMarginRequirement(Side.Short);
  });

  async function _createPositionAndIncreaseItOutsideOfMargin(direction: Side) {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await depositCollateralAndProvideLiquidity(
      lp,
      lp.ua,
      depositAmount.mul(20)
    );
    await depositCollateralAndProvideLiquidity(
      lpTwo,
      lpTwo.ua,
      depositAmount.mul(20)
    );
    await depositCollateralAndProvideLiquidity(
      deployer,
      deployer.ua,
      depositAmount.mul(20)
    );

    // position is within the margin ratio
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount,
      direction,
      0
    );

    // new position is outside the margin ratio
    await expect(
      alice.clearingHouse.changePosition(0, depositAmount.mul(15), 0, direction)
    ).to.be.revertedWith(ClearingHouseErrors.ExtendPositionInsufficientMargin);
  }

  it('Should fail to increase LONG position size if user collateral is insufficient', async () => {
    await _createPositionAndIncreaseItOutsideOfMargin(Side.Long);
  });

  it('Should fail to increase SHORT position size if user collateral is insufficient', async () => {
    await _createPositionAndIncreaseItOutsideOfMargin(Side.Short);
  });

  it('Should fail to close position if proposedAmount is null', async () => {
    await expect(
      alice.clearingHouse.changePosition(0, 0, 0, 0)
    ).to.be.revertedWith(ClearingHouseErrors.ChangePositionZeroArgument);
  });

  it('LONG positions entirely closed should return the expected profit (no funding payments involved in the profit)', async () => {
    // set-up
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await alice.clearingHouse.deposit(depositAmount, alice.ua.address);
    const initialVaultBalance = await alice.vault.getReserveValue(
      alice.address,
      false
    );

    const vQuoteLiquidityBeforePositionCreated = await alice.market.balances(
      VQUOTE_INDEX
    );

    const percentageFeeStart = (
      await get_dy(alice.curveViews, alice.market, depositAmount.div(10), 0, 1)
    ).percentageFee;
    await alice.clearingHouse.changePosition(
      0,
      depositAmount.div(10),
      0,
      Side.Long
    );

    // check intermediate vault balance
    const alicePositionBeforeClosingPosition =
      await alice.perpetual.getTraderPosition(alice.address);

    const aliceVaultBalanceBeforeClosingPosition =
      await alice.vault.getReserveValue(alice.address, false);

    const insurancePayed = rMul(depositAmount.div(10), insuranceFee);
    const tradingFeesOpenPosition = rMul(
      depositAmount.div(10),
      percentageFeeStart
    );

    expect(
      initialVaultBalance.sub(insurancePayed).sub(tradingFeesOpenPosition)
    ).to.equal(aliceVaultBalanceBeforeClosingPosition);

    const vQuoteLiquidityAfterPositionCreated = await alice.market.balances(
      VQUOTE_INDEX
    );
    const expectedAdditionalVQuote = vQuoteLiquidityBeforePositionCreated.add(
      depositAmount.div(10)
    );

    expect(vQuoteLiquidityAfterPositionCreated).to.equal(
      expectedAdditionalVQuote
    );

    // sell the entire position, i.e. user.positionSize
    const {dyExFees, percentageFee} = await get_dy(
      alice.curveViews,
      alice.market,
      alicePositionBeforeClosingPosition.positionSize,
      1,
      0
    );

    await alice.clearingHouse.changePosition(
      0,
      alicePositionBeforeClosingPosition.positionSize,
      0,
      getCloseTradeDirection(alicePositionBeforeClosingPosition)
    );

    const expectedProfit = dyExFees.add(
      alicePositionBeforeClosingPosition.openNotional
    );
    const tradingFeesClosePosition = rMul(dyExFees, percentageFee);

    const expectedNewVaultBalance = initialVaultBalance
      .add(expectedProfit)
      .sub(insurancePayed)
      .sub(tradingFeesOpenPosition)
      .sub(tradingFeesClosePosition);

    const aliceVaultBalanceAfterClosingPosition =
      await alice.vault.getReserveValue(alice.address, false);

    expect(expectedNewVaultBalance).to.equal(
      aliceVaultBalanceAfterClosingPosition
    );

    const alicePositionAfterClosingPosition =
      await alice.perpetual.getTraderPosition(alice.address);

    // when a position is entirely close, it's deleted
    expect(alicePositionAfterClosingPosition.positionSize).to.eq(0);
    expect(alicePositionAfterClosingPosition.openNotional).to.eq(0);
    expect(alicePositionAfterClosingPosition.cumFundingRate).to.eq(0);
  });

  it('SHORT positions entirely closed should return the expected profit (no funding payments involved in the profit)', async () => {
    // set-up
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await alice.clearingHouse.deposit(depositAmount, alice.ua.address);
    const initialVaultBalance = await alice.vault.getReserveValue(
      alice.address,
      false
    );

    const vQuoteLiquidityBeforePositionCreated = await alice.market.balances(
      VQUOTE_INDEX
    );

    const openTrade = await get_dy(
      alice.curveViews,
      alice.market,
      depositAmount.div(10),
      VBASE_INDEX,
      VQUOTE_INDEX
    );
    await alice.clearingHouse.changePosition(
      0,
      depositAmount.div(10),
      0,
      Side.Short
    );

    const aliceVaultBalanceBeforeClosingPosition =
      await alice.vault.getReserveValue(alice.address, false);

    const aliceUserPosition = await alice.perpetual.getTraderPosition(
      alice.address
    );
    const aliceOpenNotional = aliceUserPosition.openNotional;

    const insurancePayed = rMul(aliceOpenNotional, insuranceFee);
    const tradingFeesOpenPosition = rMul(
      aliceOpenNotional,
      openTrade.percentageFee
    );

    expect(
      initialVaultBalance.sub(insurancePayed).sub(tradingFeesOpenPosition)
    ).to.equal(aliceVaultBalanceBeforeClosingPosition);

    expect(await alice.market.balances(VQUOTE_INDEX)).to.equal(
      vQuoteLiquidityBeforePositionCreated.sub(openTrade.dyInclFees)
    );

    const proposedAmount = await getCloseProposedAmount(
      aliceUserPosition,
      alice.market,
      alice.curveViews
    );

    const {quoteProceeds, percentageFee} =
      await getProceedsFromClosingShortPosition(
        alice.market,
        alice.curveViews,
        proposedAmount
      );

    await alice.clearingHouse.changePosition(
      0,
      proposedAmount,
      0,
      getCloseTradeDirection(aliceUserPosition)
    );

    const vQuoteReceived = quoteProceeds.sub(
      rMul(quoteProceeds.abs(), percentageFee)
    );
    const expectedProfit = vQuoteReceived.add(aliceOpenNotional);

    const expectedNewVaultBalance = initialVaultBalance
      .add(expectedProfit)
      .sub(insurancePayed)
      .sub(tradingFeesOpenPosition);

    const newVaultBalance = await alice.vault.getReserveValue(
      alice.address,
      false
    );

    expect(expectedNewVaultBalance).to.equal(newVaultBalance);

    const alicePositionAfterClosingPosition =
      await alice.perpetual.getTraderPosition(alice.address);

    // when a position is entirely close, it's deleted
    expect(alicePositionAfterClosingPosition.positionSize).to.eq(0);
    expect(alicePositionAfterClosingPosition.openNotional).to.eq(0);
    expect(alicePositionAfterClosingPosition.cumFundingRate).to.eq(0);
  });

  async function _reducePosition(
    direction: Side,
    reductionFactor: number,
    isUnderOpenNotionalRequirement: boolean
  ) {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    const traderPositionBeforeFirstTrade =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    expect(traderPositionBeforeFirstTrade.openNotional).to.eq(0);
    expect(traderPositionBeforeFirstTrade.positionSize).to.eq(0);
    expect(traderPositionBeforeFirstTrade.cumFundingRate).to.eq(0);

    // position is 10% of the collateral
    const alicePosition = depositAmount.div(10);
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      alicePosition,
      direction,
      0
    );

    // CHECK TRADER POSITION
    const traderPositionAfterFirstTrade =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    if (direction === Side.Long) {
      expect(traderPositionAfterFirstTrade.positionSize).to.gt(0);
      expect(traderPositionAfterFirstTrade.openNotional).to.eq(
        depositAmount.div(10).mul(-1)
      );
    } else {
      expect(traderPositionAfterFirstTrade.openNotional).to.gt(0);
      expect(traderPositionAfterFirstTrade.positionSize).to.lt(0);
    }
    expect(traderPositionAfterFirstTrade.cumFundingRate).to.eq(0);

    if (isUnderOpenNotionalRequirement) {
      await _reducePositionShouldFailOpenNotionalRequirement(
        direction,
        reductionFactor,
        traderPositionAfterFirstTrade
      );
    } else {
      await _reducePositionShouldSucceed(
        direction,
        reductionFactor,
        traderPositionAfterFirstTrade
      );
    }
  }

  // note: this function assumes that the EVM global state has been prepared by `_reducePosition`
  async function _reducePositionShouldFailOpenNotionalRequirement(
    direction: Side,
    reductionFactor: number,
    traderPositionAfterFirstTrade: LibPerpetual.TraderPositionStructOutput
  ) {
    if (direction === Side.Long) {
      await expect(
        alice.clearingHouse.changePosition(
          0,
          traderPositionAfterFirstTrade.positionSize.div(reductionFactor),
          0,
          getCloseTradeDirection(traderPositionAfterFirstTrade)
        )
      ).to.revertedWith(ClearingHouseErrors.UnderOpenNotionalAmountRequired);
    } else {
      const vQuoteAmountToRemove = traderPositionAfterFirstTrade.openNotional
        .div(reductionFactor)
        .add(
          traderPositionAfterFirstTrade.openNotional.div(reductionFactor).div(4)
        );

      await expect(
        alice.clearingHouse.changePosition(
          0,
          vQuoteAmountToRemove,
          0,
          getCloseTradeDirection(traderPositionAfterFirstTrade)
        )
      ).to.revertedWith(ClearingHouseErrors.UnderOpenNotionalAmountRequired);
    }
  }

  // reduction ratio is calculated as ratio from two numbers
  const reductionRatio = (reductionFactor: number) => WAD.div(reductionFactor);

  // note: this function assumes that the EVM global state has been prepared by `_reducePosition`
  async function _reducePositionShouldSucceed(
    direction: Side,
    reductionFactor: number,
    traderPositionAfterFirstTrade: LibPerpetual.TraderPositionStructOutput
  ) {
    let quoteProceeds: BigNumber, baseProceeds: BigNumber;
    let openNotionalToReduce: BigNumber;
    let percentageFee;

    if (direction === Side.Long) {
      baseProceeds = traderPositionAfterFirstTrade.positionSize
        .div(reductionFactor)
        .mul(-1);

      const firstTrade = await get_dy(
        alice.curveViews,
        alice.market,
        baseProceeds.abs(),
        VBASE_INDEX,
        VQUOTE_INDEX
      );
      [quoteProceeds, percentageFee] = [
        firstTrade.dyExFees,
        firstTrade.percentageFee,
      ];

      openNotionalToReduce = rMul(
        traderPositionAfterFirstTrade.openNotional,
        reductionRatio(reductionFactor)
      );
      const pnl = quoteProceeds.add(openNotionalToReduce);
      const tradingFeesPayed = rMul(quoteProceeds.abs(), percentageFee);

      await expect(
        alice.clearingHouse.changePosition(0, baseProceeds.abs(), 0, Side.Short)
      )
        .to.emit(alice.clearingHouse, 'ChangePosition')
        .withArgs(
          0,
          alice.address,
          Side.Short,
          quoteProceeds,
          baseProceeds,
          pnl.sub(tradingFeesPayed),
          false
        );
    } else {
      quoteProceeds = traderPositionAfterFirstTrade.openNotional
        .div(reductionFactor)
        .add(
          traderPositionAfterFirstTrade.openNotional.div(reductionFactor).div(4)
        )
        .mul(-1);

      const firstTrade = await get_dy(
        alice.curveViews,
        alice.market,
        quoteProceeds.abs(),
        VQUOTE_INDEX,
        VBASE_INDEX
      );
      [baseProceeds, percentageFee] = [
        firstTrade.dyExFees,
        firstTrade.percentageFee,
      ];

      const reductionRatio = rDiv(
        baseProceeds,
        traderPositionAfterFirstTrade.positionSize.abs()
      );
      openNotionalToReduce = rMul(
        traderPositionAfterFirstTrade.openNotional,
        reductionRatio
      );
      const pnl = quoteProceeds.add(openNotionalToReduce);
      const tradingFeesPayed = rMul(quoteProceeds.abs(), percentageFee);

      await expect(
        alice.clearingHouse.changePosition(0, quoteProceeds.abs(), 0, Side.Long)
      )
        .to.emit(alice.clearingHouse, 'ChangePosition')
        .withArgs(
          0,
          alice.address,
          Side.Long,
          quoteProceeds,
          baseProceeds,
          pnl.sub(tradingFeesPayed),
          false
        );
    }

    // CHECK TRADER POSITION
    const traderPositionAfterSecondTrade =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    expect(traderPositionAfterSecondTrade.positionSize).to.eq(
      traderPositionAfterFirstTrade.positionSize.add(baseProceeds)
    );
    expect(traderPositionAfterSecondTrade.openNotional).to.eq(
      traderPositionAfterFirstTrade.openNotional.sub(openNotionalToReduce)
    );
    expect(traderPositionAfterSecondTrade.cumFundingRate).to.eq(0);

    if (direction === Side.Long) {
      await alice.clearingHouse.changePosition(
        0,
        traderPositionAfterSecondTrade.positionSize,
        0,
        getCloseTradeDirection(traderPositionAfterSecondTrade)
      );
    } else {
      const proposedAmount = await getCloseProposedAmount(
        traderPositionAfterSecondTrade,
        alice.market,
        alice.curveViews
      );

      await alice.clearingHouse.changePosition(
        0,
        proposedAmount,
        0,
        getCloseTradeDirection(traderPositionAfterSecondTrade)
      );
    }

    // CHECK TRADER POSITION
    const traderPositionAfterClosingPosition =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    expect(traderPositionAfterClosingPosition.openNotional).to.eq(0);
    expect(traderPositionAfterClosingPosition.positionSize).to.eq(0);
    expect(traderPositionAfterClosingPosition.cumFundingRate).to.eq(0);
  }

  it('Should reduce LONG position size by 50% if user tries to', async () => {
    await _reducePosition(Side.Long, 2, true);
  });
  it('Should reduce LONG position size by 20% if user tries to', async () => {
    await _reducePosition(Side.Long, 5, false);
  });

  it('Should reduce SHORT position size by 50% if user tries to', async () => {
    await _reducePosition(Side.Short, 2, true);
  });

  it('Should reduce SHORT position size by 20% if user tries to', async () => {
    await _reducePosition(Side.Short, 5, false);
  });

  it('Should fail if the amount of one trade is bigger than maxBlockTradeAmount', async () => {
    // set-up
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    await alice.ua.approve(alice.vault.address, depositAmount.mul(20));
    const MAX_BLOCK_TRADE_AMOUNT = await alice.perpetual.maxBlockTradeAmount();

    await expect(
      alice.clearingHouse.extendPositionWithCollateral(
        0,
        depositAmount.mul(20),
        alice.ua.address,
        MAX_BLOCK_TRADE_AMOUNT,
        Side.Long,
        0
      )
    ).to.be.revertedWith(PerpetualErrors.ExcessiveBlockTradeAmount);
  });

  it('Should fail if multiple trade amounts in a block are collectively larger than maxBlockTradeAmount', async () => {
    // set-up
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );
    await depositCollateralAndProvideLiquidity(
      deployer,
      deployer.ua,
      depositAmount.mul(20)
    );

    await alice.ua.approve(alice.vault.address, depositAmount.mul(20));
    const MAX_BLOCK_TRADE_AMOUNT = await alice.perpetual.maxBlockTradeAmount();

    await env.network.provider.send('evm_setAutomine', [false]);

    // 1st trade under maxBlockTradeAmount
    const firstTradePositionAmount = depositAmount.mul(10);
    const txResp1 = await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount.mul(10),
      alice.ua.address,
      firstTradePositionAmount,
      Side.Long,
      0
    );

    // sum of 1st + 2nd trades above maxBlockTradeAmount
    const diffToMaxBlockTradeAmount = MAX_BLOCK_TRADE_AMOUNT.sub(
      firstTradePositionAmount
    );

    // automatically mine next transaction (together with the previous one)
    await env.network.provider.send('evm_setAutomine', [true]);

    await expect(
      alice.clearingHouse.extendPositionWithCollateral(
        0,
        depositAmount.mul(10),
        alice.ua.address,
        diffToMaxBlockTradeAmount,
        Side.Long,
        0
      )
    ).to.be.revertedWith(PerpetualErrors.ExcessiveBlockTradeAmount);

    // first trade should run
    const txReceipt1 = await ethers.provider.getTransactionReceipt(
      txResp1.hash
    );
    expect(txReceipt1.status).to.eq(1);
  });

  async function _updateAndCheckBlockTradeAmount(
    user: User,
    openNotionalToAddToTradeAmount: BigNumber
  ): Promise<boolean> {
    await user.perpetual.__TestPerpetual__updateCurrentBlockTradeAmount(
      openNotionalToAddToTradeAmount
    );
    return await user.perpetual.__TestPerpetual__checkBlockTradeAmount();
  }

  async function _resetBlockTradeAmount(user: User) {
    await user.perpetual.__TestPerpetual__resetCurrentBlockTradeAmount();
  }

  it('Should correctly calculate the price impact', async () => {
    const MAX_BLOCK_TRADE_AMOUNT = await alice.perpetual.maxBlockTradeAmount();

    const invalidTradeAmount = MAX_BLOCK_TRADE_AMOUNT;
    expect(await _updateAndCheckBlockTradeAmount(alice, invalidTradeAmount)).to
      .be.false;
    await _resetBlockTradeAmount(alice);

    const validTradeAmount = MAX_BLOCK_TRADE_AMOUNT.sub(1);
    expect(await _updateAndCheckBlockTradeAmount(alice, validTradeAmount)).to.be
      .true;
    await _resetBlockTradeAmount(alice);
  });

  it('Should fail when minAmount is not reached', async () => {
    // set-up
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    await alice.ua.approve(alice.vault.address, depositAmount);

    const tradeAmount = depositAmount;
    const {dyExFees, dyInclFees} = await get_dy(
      alice.curveViews,
      alice.market,
      tradeAmount,
      0,
      1
    );

    await expect(
      alice.clearingHouse.extendPositionWithCollateral(
        0,
        depositAmount,
        alice.ua.address,
        tradeAmount,
        Side.Long,
        dyInclFees.add(1)
      )
    ).to.be.revertedWith('');
    await expect(
      alice.clearingHouse.extendPositionWithCollateral(
        0,
        depositAmount,
        alice.ua.address,
        tradeAmount,
        Side.Long,
        dyInclFees
      )
    ).not.to.be.reverted;

    expect(
      (await alice.perpetual.getTraderPosition(alice.address)).positionSize
    ).to.be.eq(dyExFees);
  });
  it('Should reimburse trading fees payed', async () => {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    const {dyExFees, dyInclFees} = await get_dy(
      alice.curveViews,
      alice.market,
      depositAmount,
      VQUOTE_INDEX,
      VBASE_INDEX
    );

    // position is within the margin ratio
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount,
      Side.Long,
      0
    );

    const traderPosition = await alice.clearingHouseViewer.getTraderPosition(
      0,
      alice.address
    );
    const globalPosition = await alice.clearingHouseViewer.getGlobalPosition(0);
    const totalBaseSupply = await bob.vBase.totalSupply();

    expect(traderPosition.openNotional).to.be.eq(depositAmount.mul(-1));
    expect(globalPosition.totalQuoteFeesGrowth).to.be.eq(0);
    expect(globalPosition.totalBaseFeesGrowth).to.be.eq(
      rDiv(dyExFees.sub(dyInclFees), totalBaseSupply)
    );
  });

  it('Should change from a long to a short position', async () => {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    // open long position
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount,
      Side.Long,
      0
    );

    const traderPositionBefore =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);
    expect(traderPositionBefore.positionSize).to.be.gt(0);

    // should not reverse long to short position with changePosition function
    await expect(
      alice.clearingHouse.changePosition(0, depositAmount.mul(2), 0, Side.Short)
    ).to.be.revertedWith(PerpetualErrors.AttemptReversePosition);

    await expect(
      alice.clearingHouse.openReversePosition(
        0,
        await getCloseProposedAmount(
          traderPositionBefore,
          alice.market,
          alice.curveViews
        ),
        0,
        depositAmount,
        0,
        Side.Short
      )
    ).to.not.be.reverted;

    const traderPositionAfter =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    expect(traderPositionAfter.positionSize).to.be.eq(depositAmount.mul(-1));
    expect(traderPositionAfter.openNotional).to.be.gt(0);
  });

  it('Should change from a short to a long position', async () => {
    await depositCollateralAndProvideLiquidity(
      bob,
      bob.ua,
      depositAmount.mul(20)
    );

    // open short position
    await alice.clearingHouse.extendPositionWithCollateral(
      0,
      depositAmount,
      alice.ua.address,
      depositAmount,
      Side.Short,
      0
    );

    const traderPositionBefore =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);
    expect(traderPositionBefore.positionSize).to.be.lt(0);

    // should not reverse short to long position with changePosition function
    await expect(
      alice.clearingHouse.changePosition(0, depositAmount.mul(2), 0, Side.Long)
    ).to.be.revertedWith(PerpetualErrors.AttemptReversePosition);

    await expect(
      alice.clearingHouse.openReversePosition(
        0,
        await getCloseProposedAmount(
          traderPositionBefore,
          alice.market,
          alice.curveViews
        ),
        0,
        depositAmount,
        0,
        Side.Long
      )
    ).to.not.be.reverted;

    const traderPositionAfter =
      await alice.clearingHouseViewer.getTraderPosition(0, alice.address);

    expect(traderPositionAfter.positionSize).to.be.gt(0);
    expect(traderPositionAfter.openNotional).to.be.eq(depositAmount.mul(-1));
  });

  describe('Should correctly calculate the profit of traders ', async function () {
    async function checkProfit(time: number, direction: Side) {
      // set-up
      await depositCollateralAndProvideLiquidity(
        bob,
        bob.ua,
        depositAmount.mul(20)
      );

      const SELL_INDEX = direction === Side.Long ? VQUOTE_INDEX : VBASE_INDEX;
      const BUY_INDEX = direction === Side.Long ? VBASE_INDEX : VQUOTE_INDEX;

      const balanceBefore = await alice.ua.balanceOf(alice.address);

      const {dyExFees, percentageFee} = await get_dy(
        alice.curveViews,
        alice.market,
        depositAmount,
        SELL_INDEX,
        BUY_INDEX
      );

      const notional = direction === Side.Long ? depositAmount : dyExFees;

      const insuranceFeeAmount = rMul(notional.abs(), insuranceFee);
      const tradingFeeAmount = rMul(notional.abs(), percentageFee);

      await extendPositionWithCollateral(
        alice,
        alice.ua,
        depositAmount,
        depositAmount,
        direction
      );

      // set time
      const snapshotId = await env.network.provider.send('evm_snapshot', []);
      const newTime = (await getLatestTimestamp(env)) + time;
      const eTime = BigNumber.from(newTime).add(1);

      // calculate expected profit
      const traderPosition = await alice.clearingHouseViewer.getTraderPosition(
        0,
        alice.address
      );

      // get proposed amount

      // await revertTimeAndSnapshot(env, snapshotId, newTime);
      const proposedAmount = await getCloseProposedAmount(
        traderPosition,
        alice.market,
        alice.curveViews
      );

      const eProfit = await getTraderProfit(
        alice,
        eTime,
        0,
        proposedAmount /* make sure to use the same proposed amount here*/
      );

      // close position
      await revertTimeAndSnapshot(env, snapshotId, newTime);
      const tx = await alice.clearingHouse.changePosition(
        0,
        proposedAmount,
        0,
        getCloseTradeDirection(traderPosition)
      );

      // check time passed
      const receipts = await tx.wait();
      const block = await env.ethers.provider.getBlock(receipts.blockNumber);
      expect(block.timestamp).to.be.equal(eTime.toNumber());

      // check profit
      await withdrawCollateral(alice, alice.ua);
      const balanceAfter = await alice.ua.balanceOf(alice.address);
      expect(balanceAfter).to.be.eq(
        balanceBefore.add(eProfit).sub(insuranceFeeAmount).sub(tradingFeeAmount)
      );
    }

    it('Should calculate profit | minutes(33), Side.Long', async () => {
      await checkProfit(minutes(33), Side.Long);
    });

    it('Should calculate profit | minutes(3), Side.Long', async () => {
      await checkProfit(minutes(3), Side.Long);
    });

    it('Should calculate profit | minutes(21), Side.Short', async () => {
      await checkProfit(minutes(21), Side.Short);
    });

    it('Should calculate profit | minutes(3), Side.Short', async () => {
      await checkProfit(minutes(3), Side.Short);
    });
  });

  describe('Trading operations should use all collaterals', function () {
    it('Should open position with margin from different collaterals', async function () {
      // provide liquidity
      await depositCollateralAndProvideLiquidity(
        bob,
        bob.ua,
        depositAmount.mul(20)
      );

      const usdcDepositAmount = await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount,
        [alice, bob]
      );

      // open a position using USDC as collateral
      const percentageFee = await alice.curveViews.get_dy_fees_perc(
        alice.market.address,
        VQUOTE_INDEX,
        VBASE_INDEX,
        depositAmount
      );
      await expect(
        alice.clearingHouse.extendPositionWithCollateral(
          0,
          usdcDepositAmount,
          alice.usdc.address,
          depositAmount,
          Side.Long,
          0
        )
      )
        .to.emit(alice.vault, 'Deposit')
        .to.emit(alice.clearingHouse, 'ChangePosition');

      // trader openNotional in 18 decimals as usual (virtual tokens)
      const absAliceOpenNotional = (
        await alice.perpetual.getTraderPosition(alice.address)
      ).openNotional.abs();
      expect(absAliceOpenNotional).to.eq(depositAmount);

      // trader collateral in USD harmonized to 18 decimals
      const usdcDepositWadAmount = await tokenToWad(
        await alice.usdc.decimals(),
        usdcDepositAmount
      );
      const aliceReserveValue = await alice.clearingHouseViewer.getReserveValue(
        alice.address,
        false
      );

      const eInsuranceFee = rMul(absAliceOpenNotional, insuranceFee);
      const eTradingFee = rMul(absAliceOpenNotional, percentageFee);

      // note: fundingRate is null in this case
      const eNewVaultBalance = usdcDepositWadAmount
        .sub(eInsuranceFee)
        .sub(eTradingFee);

      expect(eNewVaultBalance).to.eq(aliceReserveValue);
    });

    it('Should add all collaterals when opening position', async function () {
      // provide liquidity
      await depositCollateralAndProvideLiquidity(
        bob,
        bob.ua,
        depositAmount.mul(20)
      );
      await depositCollateralAndProvideLiquidity(
        deployer,
        deployer.ua,
        depositAmount.mul(20)
      );

      const usdcDepositAmount = await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount.div(10),
        [alice, bob]
      );

      // provide some collateral in UA
      await alice.clearingHouse.deposit(
        depositAmount.div(10),
        alice.ua.address
      );
      const aliceReserveValueAfterFirstDeposit =
        await alice.clearingHouseViewer.getReserveValue(alice.address, false);

      await expect(
        alice.clearingHouse.changePosition(
          0,
          depositAmount.mul(2),
          0,
          Side.Long
        )
      ).to.be.revertedWith(
        ClearingHouseErrors.ExtendPositionInsufficientMargin
      );

      // double this amount using USDC
      await alice.clearingHouse.deposit(usdcDepositAmount, alice.usdc.address);
      const aliceReserveValueAfterSecondDeposit =
        await alice.clearingHouseViewer.getReserveValue(alice.address, false);

      expect(aliceReserveValueAfterSecondDeposit).to.eq(
        aliceReserveValueAfterFirstDeposit.mul(2)
      );

      await expect(
        alice.clearingHouse.changePosition(
          0,
          depositAmount.mul(2),
          0,
          Side.Long
        )
      ).to.not.be.reverted;
    });
  });
});

// TEST CHECKING EXCHANGE RATES KEPT FOR REFERENCE
//
// it('No exchange rate applied for SHORT positions', async () => {
//   // set-up
//   await setUpPoolLiquidity(bob, depositAmountUSDC.mul(200));
//   await alice.clearingHouse.deposit(depositAmountUSDC, alice.usdc.address);

//   const vBaseLiquidityBeforePositionCreated = await alice.market.balances(
//     VBASE_INDEX
//   );

//   await alice.clearingHouse.changePosition(0,depositAmount.div(10), Side.Short);

//   const vBaseLiquidityAfterPositionCreated = await alice.market.balances(
//     VBASE_INDEX
//   );
//   const alicePositionNotional = (
//     await alice.perpetual.getTraderPosition(alice.address)
//   ).openNotional;

//   // verify that EUR_USD exchange rate is applied to positionNotionalAmount
//   // vBaseLiquidityAfterPositionCreated = vBaseLiquidityBeforePositionCreated - rDiv(positionNotionalAmount, EUR_USD)

//   const positionNotionalAmount = await tokenToWad(
//     await alice.vault.getReserveTokenDecimals(),
//     depositAmountUSDC
//   );
//   // const alicePositionInEuro = rDiv(positionNotionalAmount, EUR_USD);
//   // const expectedVBaseLiquidityAfterPositionCreated =
//   //   vBaseLiquidityBeforePositionCreated.add(alicePositionInEuro);

//   // expect(vBaseLiquidityAfterPositionCreated).to.equal(
//   //   expectedVBaseLiquidityAfterPositionCreated
//   // );

//   await alice.clearingHouse.reducePosition(0,
//     (
//       await alice.perpetual.getTraderPosition(alice.address)
//     ).positionSize
//   );

//   const vBaseLiquidityAfterPositionClosed = await alice.market.balances(
//     VBASE_INDEX
//   );

//   // // expectedVBaseReceived = rMul((user.profit + user.openNotional), EUR_USD)
//   // const alicePositionProfit = (
//   //   await alice.perpetual.getTraderPosition(alice.address)
//   // ).profit;
//   // const expectedVQuoteProceeds = alicePositionProfit.add(
//   //   alicePositionNotional
//   // );
//   // const expectedVBaseReceived = rDiv(expectedVQuoteProceeds, EUR_USD);

//   // // expectedVBaseReceived = vBaseLiquidityAfterPositionCreated - vBaseLiquidityAfterPositionClosed
//   // const vBaseLiquidityDiff = vBaseLiquidityAfterPositionCreated.sub(
//   //   vBaseLiquidityAfterPositionClosed
//   // );

//   // // there's a difference of 1 wei between the 2 values
//   // // vBaseLiquidityDiff: 8796304059175223295
//   // // expectedVBaseReceived: 8796304059175223294
//   // // probably a rounding error in `rDiv`
// });
//   // expect(vBaseLiquidityDiff).to.be.eq(expectedVBaseReceived,);
