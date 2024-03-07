import {expect} from 'chai';
import {constants, utils, BigNumber} from 'ethers';

import {rDiv, rMul} from '../helpers/utils/calculations';
import {setup, createUABalance, User} from '../helpers/setup';
import {
  burnUA,
  depositIntoVault,
  depositCollateralAndProvideLiquidity,
  whiteListUSDCAsCollateral,
  addUSDCCollateralAndUSDCBalanceToUsers,
  whiteListAsset,
  addTokenToUser,
} from '../helpers/PerpetualUtilsFunctions';
import {Side} from '../helpers/utils/types';
import {ClearingHouseErrors} from '../../helpers/errors';
import {getLatestTimestamp} from '../../helpers/misc-utils';
import env, {ethers} from 'hardhat';
import {
  getLiquidityProviderProposedAmount,
  getLpProfit,
} from '../helpers/LiquidityGetters';
import {WAD} from '../../helpers/constants';
import {IERC20Metadata} from '../../typechain';
import {
  deployETHUSDMarket,
  deployJPYUSDMarket,
} from '../helpers/deployNewMarkets';
import {getCloseProposedAmount} from '../helpers/TradingGetters';
import {getMarket} from '../helpers/PerpetualGetters';

const ONE_ETH = utils.parseEther('1');

/*
 * Test liquidation on the main contract.
 *
 * Note: generating successful liquidations because of insufficient `collateral` or `unrealizedPositionPnl`
 * is very hard to do without mocking the Vault and the PoolTWAPOracle contracts.
 * As a result, liquidations are done using unfavorable funding payments.
 */
describe('Increment: liquidation', () => {
  let alice: User;
  let bob: User;
  let lp: User;
  let deployer: User;
  let depositAmount: BigNumber;
  let aliceAmount: BigNumber;
  let tradeAmount: BigNumber;

  // protocol constants
  let liquidationReward: BigNumber;
  let liquidationDiscount: BigNumber;
  let minMargin: BigNumber;

  before('Get protocol constants', async () => {
    ({alice, bob, lp, deployer} = await setup());

    liquidationReward = await alice.clearingHouse.liquidationReward();
    liquidationDiscount = await alice.clearingHouse.liquidationDiscount();
    minMargin = await alice.clearingHouse.minMargin();
  });

  beforeEach(
    'Give Alice funds and approve transfer by the vault to her balance',
    async () => {
      ({alice, bob, lp, deployer} = await setup());

      depositAmount = await createUABalance([alice, bob, lp, deployer]);
      aliceAmount = depositAmount.div(10); // Alice deposits and exchanges 10% of the pool liquidity
      tradeAmount = depositAmount.div(50); // trade 2% of the pool liquidity

      await depositCollateralAndProvideLiquidity(bob, bob.ua, depositAmount);
      await alice.ua.approve(alice.vault.address, aliceAmount);
      await alice.clearingHouse.deposit(aliceAmount, alice.ua.address);
    }
  );

  describe('Increment: Liquidate a trader', () => {
    it('Should fail if liquidator tries to liquidate a position of a user having no position', async () => {
      await expect(
        bob.clearingHouse.liquidate(0, alice.address, depositAmount, true)
      ).to.be.revertedWith(ClearingHouseErrors.LiquidateInvalidPosition);
    });

    it('Should fail if user has enough margin', async () => {
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Long);

      await expect(
        bob.clearingHouse.liquidate(0, alice.address, depositAmount, true)
      ).to.be.revertedWith(ClearingHouseErrors.LiquidateValidMargin);
    });

    it('Should liquidate LONG position out-of-the-money', async () => {
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Long);

      const aliceVaultBalanceBeforeClosingPosition =
        await alice.vault.getReserveValue(alice.address, false);
      const bobVaultBalanceBeforeLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );
      const insuranceUABalanceBeforeLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      // make the funding rate negative so that the Alice's position drops below minMargin
      const timestampForkedMainnetBlock = 1639682285;
      const timestampJustBefore = timestampForkedMainnetBlock - 15;
      await bob.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
        timestampJustBefore,
        utils.parseEther('10000') // set very large cumFundingRate so that the position ends up below minMargin
      );

      const alicePositionBefore = await alice.perpetual.getTraderPosition(
        alice.address
      );

      // Check `LiquidationCall` event sent with proper values
      await expect(
        bob.clearingHouse.liquidate(
          0,
          alice.address,
          alicePositionBefore.positionSize,
          true
        )
      )
        .to.emit(alice.clearingHouse, 'LiquidationCall')
        .withArgs(
          0,
          alice.address,
          bob.address,
          alicePositionBefore.openNotional.abs()
        );

      // Check trader's position is closed, i.e. user.openNotional and user.positionSize = 0
      const alicePosition = await alice.perpetual.getTraderPosition(
        alice.address
      );
      expect(alicePosition.openNotional).to.eq(0);
      expect(alicePosition.positionSize).to.eq(0);

      // Check trader's vault.balance is reduced by negative profit and liquidation fee
      const aliceVaultBalanceAfterClosingPosition =
        await alice.vault.getReserveValue(alice.address, false);
      expect(aliceVaultBalanceAfterClosingPosition).to.be.lt(
        aliceVaultBalanceBeforeClosingPosition
      );

      // Check liquidator's vault.balance is increased by the liquidation reward
      const liquidationRewardAmount = rMul(tradeAmount, liquidationReward);
      // uint256 liquidatorLiquidationReward = liquidationRewardAmount.wadMul(1e18 - liquidationRewardInsuranceShare);
      const liquidationRewardInsuranceShare =
        await bob.clearingHouse.liquidationRewardInsuranceShare();
      const liquidatorLiquidationReward = rMul(
        liquidationRewardAmount,
        ONE_ETH.sub(liquidationRewardInsuranceShare)
      );
      const insuranceLiquidationReward = rMul(
        liquidationRewardAmount,
        liquidationRewardInsuranceShare
      );

      const bobVaultBalanceAfterLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );
      expect(bobVaultBalanceAfterLiquidation).to.eq(
        bobVaultBalanceBeforeLiquidation.add(liquidatorLiquidationReward)
      );

      const insuranceUABalanceAfterLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      expect(insuranceUABalanceAfterLiquidation).to.eq(
        insuranceUABalanceBeforeLiquidation.add(insuranceLiquidationReward)
      );
    });

    async function _tryLiquidatePositionWithLowProposedAmount(direction: Side) {
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, direction);

      // make the funding rate negative so that the Alice's position drops below minMargin
      const timestampForkedMainnetBlock = 1639682285;
      const timestampJustBefore = timestampForkedMainnetBlock - 15;

      let insufficientAmountToClosePosition;
      if (direction === Side.Long) {
        await bob.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
          timestampJustBefore,
          utils.parseEther('10000') // set very large positive cumFundingRate so that LONG position ends up below minMargin
        );

        const alicePositionSize = (
          await alice.perpetual.getTraderPosition(alice.address)
        ).positionSize;

        insufficientAmountToClosePosition = alicePositionSize.sub(
          alicePositionSize.div(10)
        );
      } else {
        await bob.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
          timestampJustBefore,
          utils.parseEther('10000').mul(-1) // set very large negative cumFundingRate so that SHORT position ends up below minMargin
        );

        insufficientAmountToClosePosition = tradeAmount;
      }

      await expect(
        bob.clearingHouse.liquidate(
          0,
          alice.address,
          insufficientAmountToClosePosition,
          true
        )
      ).to.be.revertedWith(
        ClearingHouseErrors.LiquidateInsufficientProposedAmount
      );
    }

    it('Should fail if the proposed proposedAmount is insufficient to liquidate a full LONG position', async () => {
      await _tryLiquidatePositionWithLowProposedAmount(Side.Long);
    });

    it('Should fail if the proposed proposedAmount is insufficient to liquidate a full SHORT position', async () => {
      await _tryLiquidatePositionWithLowProposedAmount(Side.Short);
    });

    it('Should liquidate SHORT position out-of-the-money', async () => {
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Short);
      const alicePositionBefore = await alice.perpetual.getTraderPosition(
        alice.address
      );

      const aliceVaultBalanceBeforeClosingPosition =
        await alice.vault.getReserveValue(alice.address, false);
      const bobVaultBalanceBeforeLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );
      const insuranceUABalanceBeforeLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      // make the funding rate negative so that the Alice's position drops below minMargin
      const timestampForkedMainnetBlock = 1639682285;
      const timestampJustBefore = timestampForkedMainnetBlock - 15;
      await bob.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
        timestampJustBefore,
        utils.parseEther('100').mul(-1) // set very large negative cumFundingRate so that the position ends up below minMargin
      );

      const proposedAmount = await getCloseProposedAmount(
        alicePositionBefore,
        alice.market,
        alice.curveViews
      );

      await expect(
        bob.clearingHouse.liquidate(0, alice.address, proposedAmount, true)
      ).to.emit(alice.clearingHouse, 'LiquidationCall');

      // Check trader's position is closed, i.e. user.openNotional and user.positionSize = 0
      const alicePosition = await alice.perpetual.getTraderPosition(
        alice.address
      );
      expect(alicePosition.openNotional).to.eq(0);
      expect(alicePosition.positionSize).to.eq(0);

      // Check trader's vault.balance is reduced by negative profit and liquidation fee
      const aliceVaultBalanceAfterClosingPosition =
        await alice.vault.getReserveValue(alice.address, false);
      expect(aliceVaultBalanceAfterClosingPosition).to.be.lt(
        aliceVaultBalanceBeforeClosingPosition
      );

      const liquidationRewardAmount = rMul(
        alicePositionBefore.openNotional,
        liquidationReward
      );
      const liquidationRewardInsuranceShare =
        await bob.clearingHouse.liquidationRewardInsuranceShare();
      const liquidatorLiquidationReward = rMul(
        liquidationRewardAmount,
        ONE_ETH.sub(liquidationRewardInsuranceShare)
      );
      const insuranceLiquidationReward = rMul(
        liquidationRewardAmount,
        liquidationRewardInsuranceShare
      );

      const bobVaultBalanceAfterLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );
      const insuranceUABalanceAfterLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      expect(bobVaultBalanceAfterLiquidation).to.be.eq(
        bobVaultBalanceBeforeLiquidation.add(liquidatorLiquidationReward)
      );
      expect(insuranceUABalanceAfterLiquidation).to.be.eq(
        insuranceUABalanceBeforeLiquidation.add(insuranceLiquidationReward)
      );
    });

    async function _liquidateAccountWithFundingRate(
      liquidatee: User,
      liquidator: User,
      TARGET_MARGIN: BigNumber
    ) {
      /* Note:
    This test relies on the assumption that the unrealizedPnL (based on the oracle price) is equal
    or at least similar to the realized profit and loss.
    Otherwise, the trader's profit (and as a consequence its vault balance after liquidation)
    could differ significantly from the expected result.

    ******************* TASK *******************

    Set to a small cumFundingRate so that the position ends up below minMargin but not below the liquidationReward

    Why:
    Otherwise the liquidation results in a loss of the protocol.

    The positions after the liquidation are:

    (A) Collateral of liquidator = quoteProceeds * liquidationReward

    (B) Collateral of liquidatee = collateral + unrealizedPnL                         + fundingPayment - notional      * liquidationReward

                                = collateral + positionSize * price - notionalAmount + fundingPayment - quoteProceeds * liquidationReward

                                = collateral + quoteProceeds        - notionalAmount + fundingPayment - quoteProceeds * liquidationReward

                                = collateral - notionalAmount + fundingPayment + (1 - liquidationReward) * quoteProceeds

    When minMargin < liquidationReward, the second equation will always be negative.

    ******************* SOLUTION ***************

    We have to set the fundingRate in way that:

    minMargin > marginRatio > liquidationReward

    First, realize define funding payments as:

        marginRatio                                                        = (collateral + unrealizedPositionPnl + fundingPayments) / absOpenNotional
    <=> marginRatio * absOpenNotional                                      = (collateral + unrealizedPositionPnl + fundingPayments)
    <=> marginRatio * absOpenNotional - collateral - unrealizedPositionPnL = fundingPayments

    So the following condition has to be satisfied:

    (1) minMargin * absOpenNotional - collateral - unrealizedPositionPn > fundingPayments

    We continue with the strict equality:

        minMargin * absOpenNotional - collateral - unrealizedPositionPn  = fundingPayments

    Second, the fundingPayment is equal to

    (2) fundingPayments                = positionSize * fundingRate
    <=> fundingPayments / positionSize = fundingRate

    in our example.

    Plugging in all numbers into (1) we derive:

    2.5% (minMargin) * 226 (absOpenNotional) - 999 (collateral) - 0.21755(unrealizedPnL) = -993.5676 := fundingPayments

    and with positionSize = 200 ('tradeAmount') into (2) we get:

    fundingRate = -993.5676 / 200 ~= -4.9678

    ******************* RESULT ***************

    fundingRate = -4.9678

    */
      const traderPosition = await liquidatee.perpetual.getTraderPosition(
        liquidatee.address
      );
      const openNotional = traderPosition.openNotional;
      expect(openNotional).to.be.gt(0); // has short position
      const baseDebt = rMul(
        traderPosition.positionSize,
        await liquidatee.perpetual.indexPrice()
      );
      expect(baseDebt).to.be.lt(0);

      const collateral = await liquidatee.vault.getReserveValue(
        liquidatee.address,
        false
      );

      const unrealizedPnLOracle =
        await liquidatee.clearingHouseViewer.getTraderUnrealizedPnL(
          0,
          liquidatee.address
        );

      // eq (1)
      const funding = rMul(TARGET_MARGIN, baseDebt.abs())
        .sub(collateral)
        .sub(unrealizedPnLOracle);

      // eq (2)
      const fundingRate = rDiv(funding, tradeAmount).sub(1); // 1 subtracted to make position liquidatable

      // set funding rate
      await liquidator.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
        (await getLatestTimestamp(env)) - 15,
        fundingRate
      );

      // check that user margin is (liquidationReward, minMargin)
      const liquidateeMargin = await liquidatee.clearingHouseViewer.marginRatio(
        liquidatee.address
      );

      // check to show (1) and (2) arrive at the correct result
      expect(liquidateeMargin).to.be.lt(minMargin);
      expect(liquidateeMargin).to.be.eq(TARGET_MARGIN.sub(1)); // margin is just below the target

      // Check `LiquidationCall` event sent with proper values
      const proposedAmount = await getCloseProposedAmount(
        traderPosition,
        liquidatee.market,
        liquidatee.curveViews
      );
      await expect(
        liquidator.clearingHouse.liquidate(
          0,
          liquidatee.address,
          proposedAmount,
          true
        )
      )
        .to.emit(liquidatee.clearingHouse, 'LiquidationCall')
        .withArgs(
          0,
          liquidatee.address,
          liquidator.address,
          openNotional.abs()
        );

      // Check trader's position is closed, i.e. user.openNotional and user.positionSize = 0
      const liquidateePosition = await liquidatee.perpetual.getTraderPosition(
        liquidatee.address
      );
      expect(liquidateePosition.openNotional).to.eq(0);
      expect(liquidateePosition.positionSize).to.eq(0);
    }

    it('Liquidations with margin in (LIQUIDATION_REWARD, MIN_MARGIN) should not generate bad debt', async () => {
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Short);
      const positionOpenNotional = (
        await alice.perpetual.getTraderPosition(alice.address)
      ).openNotional;

      const bobVaultBalanceBeforeLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );

      const insuranceUABalanceBeforeLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      // liquidate account with target margin ratio slightly below the minimum margin
      await _liquidateAccountWithFundingRate(alice, bob, minMargin);

      const liquidationRewardAmount = rMul(
        positionOpenNotional,
        liquidationReward
      );
      const liquidationRewardInsuranceShare =
        await bob.clearingHouse.liquidationRewardInsuranceShare();
      const liquidatorLiquidationReward = rMul(
        liquidationRewardAmount,
        ONE_ETH.sub(liquidationRewardInsuranceShare)
      );
      const insuranceLiquidationReward = rMul(
        liquidationRewardAmount,
        liquidationRewardInsuranceShare
      );

      const bobVaultBalanceAfterLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );
      const insuranceUABalanceAfterLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      expect(bobVaultBalanceAfterLiquidation).to.be.eq(
        bobVaultBalanceBeforeLiquidation.add(liquidatorLiquidationReward)
      );
      expect(insuranceUABalanceAfterLiquidation).to.eq(
        insuranceUABalanceBeforeLiquidation.add(insuranceLiquidationReward)
      );

      // Check trader's vault.balance is reduced by negative profit and liquidation fee
      // BUT it is still larger than 0
      expect(await alice.vault.getReserveValue(alice.address, false)).to.be.gt(
        0
      );
    });

    it('Liquidations with margin < LIQUIDATION_REWARD should generate bad debt', async () => {
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Short);
      const positionOpenNotional = (
        await alice.perpetual.getTraderPosition(alice.address)
      ).openNotional;

      const bobVaultBalanceBeforeLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );
      const insuranceUABalanceBeforeLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      // liquidate account with target margin ratio slightly below the minimum
      await _liquidateAccountWithFundingRate(
        alice,
        bob,
        liquidationReward.div(2)
      );

      // Check liquidator's vault.balance is increased by the liquidation reward
      const liquidationRewardAmount = rMul(
        positionOpenNotional,
        liquidationReward
      );
      const liquidationRewardInsuranceShare =
        await bob.clearingHouse.liquidationRewardInsuranceShare();
      const liquidatorLiquidationReward = rMul(
        liquidationRewardAmount,
        ONE_ETH.sub(liquidationRewardInsuranceShare)
      );
      const insuranceLiquidationReward = rMul(
        liquidationRewardAmount,
        liquidationRewardInsuranceShare
      );

      const bobVaultBalanceAfterLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );
      const insuranceUABalanceAfterLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      expect(bobVaultBalanceAfterLiquidation).to.be.eq(
        bobVaultBalanceBeforeLiquidation.add(liquidatorLiquidationReward)
      );
      expect(insuranceUABalanceAfterLiquidation).to.eq(
        insuranceUABalanceBeforeLiquidation.add(insuranceLiquidationReward)
      );

      // Check trader's vault.balance is reduced by negative profit and liquidation fee
      // AND it is less than 0
      expect(await alice.vault.getReserveValue(alice.address, false)).to.be.lt(
        0
      );
    });
  });

  describe('Increment: Liquidate and seize debt of LP', () => {
    it('Should liquidate a liquidity provider when under margin requirement', async () => {
      // init
      await depositCollateralAndProvideLiquidity(lp, lp.ua, depositAmount);
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Short);

      // make the funding rate negative so that the Alice's position drops below minMargin
      await bob.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
        (await getLatestTimestamp(env)) - 15,
        utils.parseEther('110') // set very large negative cumFundingRate so that the position ends up below minMargin
      );
      await bob.perpetual.__TestPerpetual_updateGlobalState();

      // position should be liquidatable
      const lpPositionAfterWithdrawal =
        await bob.clearingHouseViewer.getLpPositionAfterWithdrawal(
          0,
          lp.address
        );

      expect(lpPositionAfterWithdrawal.positionSize).to.gt(0);
      expect(
        await bob.clearingHouseViewer.getLpFundingPayments(0, lp.address)
      ).to.lt(0);
      expect(await bob.clearingHouseViewer.isMarginValid(lp.address, minMargin))
        .to.be.false;

      // get parameters before liquidation
      const positionOpenNotional = (
        await lp.perpetual.getLpOpenNotional(lp.address)
      ).abs();

      const lpVaultBalanceBeforeClosingPosition =
        await lp.vault.getReserveValue(lp.address, false);
      const bobVaultBalanceBeforeLiquidation = await bob.vault.getReserveValue(
        bob.address,
        false
      );

      const insuranceUABalanceBeforeLiquidation = await bob.ua.balanceOf(
        bob.insurance.address
      );

      // predict results
      const time = await getLatestTimestamp(env);
      const lpProfit = await getLpProfit(lp, BigNumber.from(time), 0, true);

      // liquidate
      const proposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        await bob.clearingHouseViewer.getLpPosition(0, lp.address)
      );
      await expect(
        bob.clearingHouse.liquidate(0, lp.address, proposedAmount, false)
      ).to.emit(alice.clearingHouse, 'LiquidationCall');

      // Check liquidator's vault.balance is increased by the liquidation reward
      const liquidationRewardAmount = rMul(
        positionOpenNotional,
        liquidationReward
      );
      const liquidationRewardInsuranceShare =
        await bob.clearingHouse.liquidationRewardInsuranceShare();
      const liquidatorLiquidationReward = rMul(
        liquidationRewardAmount,
        ONE_ETH.sub(liquidationRewardInsuranceShare)
      );
      const insuranceLiquidationReward = rMul(
        liquidationRewardAmount,
        liquidationRewardInsuranceShare
      );
      expect(await bob.vault.getReserveValue(bob.address, false)).to.be.eq(
        bobVaultBalanceBeforeLiquidation.add(liquidatorLiquidationReward)
      );
      expect(await bob.ua.balanceOf(bob.insurance.address)).to.eq(
        insuranceUABalanceBeforeLiquidation.add(insuranceLiquidationReward)
      );

      // check liquidatee`s  vault balance is decreased by the liquidation reward
      expect(await lp.vault.getReserveValue(lp.address, false)).to.be.eq(
        lpVaultBalanceBeforeClosingPosition
          .add(lpProfit)
          .sub(liquidationRewardAmount)
      );
    });

    it('Should revert when LP has a position open', async () => {
      await depositCollateralAndProvideLiquidity(lp, lp.ua, depositAmount);
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Long);

      await expect(
        deployer.clearingHouse.seizeCollateral(lp.address)
      ).to.be.revertedWith(ClearingHouseErrors.SeizeCollateralStillOpen);
    });

    it('Should revert when no LP debt', async () => {
      await expect(
        deployer.clearingHouse.seizeCollateral(lp.address)
      ).to.be.revertedWith(ClearingHouseErrors.LiquidationDebtSizeZero);
    });

    it('Should seize non-UA collaterals of a LP with a UA debt and Insurance fills the gap', async function () {
      await bob.insurance.__TestInsurance_fundInsurance(depositAmount);

      await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount,
        [lp]
      );

      await depositCollateralAndProvideLiquidity(lp, lp.usdc, depositAmount);

      // open a trading position to shift the ratio in the market/pool a little bit,
      // otherwise hard to make the LP fall below the margin requirement if the ratio is totally even
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Short);

      const initialLPUSDCBalance = await lp.vault.getBalance(lp.address, 1);

      await lp.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
        (await getLatestTimestamp(env)) - 15,
        utils.parseEther('110') // set very large negative cumFundingRate so that the position ends up below minMargin
      );
      await lp.perpetual.__TestPerpetual_updateGlobalState();

      expect(await lp.clearingHouseViewer.isMarginValid(lp.address, minMargin))
        .to.be.false;

      // liquidate
      const proposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        await bob.clearingHouseViewer.getLpPosition(0, lp.address)
      );
      await expect(
        bob.clearingHouse.liquidate(0, lp.address, proposedAmount, false)
      ).to.emit(bob.clearingHouse, 'LiquidationCall');

      const initialDeployerUABalance = await deployer.ua.balanceOf(
        deployer.address
      );

      // seize collateral
      const usdcBalance = await lp.vault.getBalance(lp.address, 1);
      const usdcCollateralUSDValue =
        await lp.vault.__TestVault_getUndiscountedCollateralUSDValue(
          lp.usdc.address,
          usdcBalance
        );
      const discountedUSDCPrice = rMul(
        usdcCollateralUSDValue,
        liquidationDiscount
      );
      await deployer.ua.approve(deployer.vault.address, discountedUSDCPrice);

      const insuranceUABalanceBeforeSteppingIn = await lp.ua.balanceOf(
        lp.insurance.address
      );
      const liquidateeUABalanceBeforeCollateralSeized =
        await lp.vault.getBalance(lp.address, 0);

      await expect(deployer.clearingHouse.seizeCollateral(lp.address))
        .to.emit(deployer.clearingHouse, 'SeizeCollateral')
        .withArgs(lp.address, deployer.address)
        .to.emit(deployer.vault, 'TraderBadDebtGenerated');

      // 1. seizor/liquidator balance change
      const seizorUABalanceAfterUSDCBuy = await deployer.ua.balanceOf(
        deployer.address
      );
      const seizorUSDCBalanceAfterUSDCBuy = await deployer.vault.getBalance(
        deployer.address,
        1
      );

      expect(seizorUABalanceAfterUSDCBuy).to.be.eq(
        initialDeployerUABalance.sub(discountedUSDCPrice)
      );
      expect(seizorUSDCBalanceAfterUSDCBuy).to.be.eq(initialLPUSDCBalance);

      // 2. liquidatee balance change
      const lpUADebtAfterUSDCCollateralSellOff = await lp.vault.getBalance(
        lp.address,
        0
      );
      expect(lpUADebtAfterUSDCCollateralSellOff).to.eq(0);

      const lpUSDCBalanceAfterUSDCSellOff = await lp.vault.getBalance(
        lp.address,
        1
      );
      expect(lpUSDCBalanceAfterUSDCSellOff).to.eq(0);

      // 3. insurance balance change
      const eInsuranceUABalanceDiff = liquidateeUABalanceBeforeCollateralSeized
        .add(discountedUSDCPrice)
        .abs();
      const eInsuranceUABalanceAfterSteppingIn =
        insuranceUABalanceBeforeSteppingIn.sub(eInsuranceUABalanceDiff);

      const insuranceUABalanceAfterSteppingIn = await lp.ua.balanceOf(
        lp.insurance.address
      );
      expect(insuranceUABalanceAfterSteppingIn).to.eq(
        eInsuranceUABalanceAfterSteppingIn
      );
    });
  });

  describe('Increment: Liquidate user across trading and LP positions', () => {
    it('Liquidate trading and LP positions of the user in one market', async () => {
      await bob.insurance.__TestInsurance_fundInsurance(depositAmount);

      // create trader position
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Short);

      // create LP position
      await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount,
        [alice]
      );

      await depositCollateralAndProvideLiquidity(
        alice,
        alice.usdc,
        depositAmount
      );

      // make the funding rate negative so that the Alice's position drops below minMargin
      const timestampForkedMainnetBlock = 1639682285;
      const timestampJustBefore = timestampForkedMainnetBlock - 15;
      await bob.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
        timestampJustBefore,
        utils.parseEther('150').mul(-1) // set very large negative cumFundingRate so that the position ends up below minMargin
      );

      // liquidate trading position
      const proposedAmount = await getCloseProposedAmount(
        await alice.clearingHouseViewer.getTraderPosition(0, alice.address),
        alice.market,
        alice.curveViews
      );

      await bob.clearingHouse.liquidate(0, alice.address, proposedAmount, true);

      const aliceUABalanceAfterFirstLiquidation = await alice.vault.getBalance(
        alice.address,
        0
      );

      expect(
        await alice.clearingHouseViewer.isMarginValid(alice.address, minMargin)
      ).to.be.false;

      // liquidate LP position
      const proposedAmountToLiquidateLPPosition =
        await getLiquidityProviderProposedAmount(
          alice,
          await alice.clearingHouseViewer.getLpPosition(0, alice.address)
        );
      await expect(
        bob.clearingHouse.liquidate(
          0,
          alice.address,
          proposedAmountToLiquidateLPPosition,
          false
        )
      ).to.emit(bob.clearingHouse, 'LiquidationCall');

      const aliceUABalanceAfterSecondLiquidation = await alice.vault.getBalance(
        alice.address,
        0
      );

      expect(aliceUABalanceAfterSecondLiquidation).to.be.lt(
        aliceUABalanceAfterFirstLiquidation
      );

      // seize collateral
      const aliceUSDCCollateral = await alice.vault.getBalance(
        alice.address,
        1
      );
      const liquidatorUABalanceBeforeSteppingIn = await deployer.ua.balanceOf(
        deployer.address
      );
      const aliceUAVaultBalanceBeforeCollateralSale =
        await deployer.vault.getBalance(alice.address, 0);
      const discountedUSDCPrice = rMul(
        aliceUSDCCollateral,
        liquidationDiscount
      );
      await deployer.ua.approve(deployer.vault.address, discountedUSDCPrice);

      const insuranceUABalanceBeforeSteppingIn = await deployer.ua.balanceOf(
        lp.insurance.address
      );
      const uaDebtRemainingAfterCollateralSale =
        aliceUAVaultBalanceBeforeCollateralSale.add(discountedUSDCPrice).abs();

      await expect(deployer.clearingHouse.seizeCollateral(alice.address))
        .to.emit(deployer.vault, 'TraderBadDebtGenerated')
        .withArgs(alice.address, uaDebtRemainingAfterCollateralSale);

      const eInsuranceUABalanceAfterSteppingIn =
        insuranceUABalanceBeforeSteppingIn.sub(
          uaDebtRemainingAfterCollateralSale
        );

      expect(await alice.vault.getBalance(alice.address, 0)).to.eq(0);
      expect(await deployer.ua.balanceOf(deployer.address)).to.eq(
        liquidatorUABalanceBeforeSteppingIn.sub(discountedUSDCPrice)
      );
      expect(await deployer.ua.balanceOf(lp.insurance.address)).to.eq(
        eInsuranceUABalanceAfterSteppingIn
      );
    });
    it('Liquidate user across multiple markets', async () => {
      const EURUSDMarketIdx = 0;
      const JPYUSDMarketIdx = 1;

      // alice opens trading position on EUR_USD
      await alice.clearingHouse.changePosition(
        EURUSDMarketIdx,
        tradeAmount,
        0,
        Side.Short
      );

      // alice provides liquidity on JYP_USD
      await deployJPYUSDMarket();
      await createUABalance([alice]);

      // have 2 other users provide some liquidity to avoid Curve errors
      await depositCollateralAndProvideLiquidity(
        lp,
        lp.ua,
        depositAmount,
        JPYUSDMarketIdx
      );
      await depositCollateralAndProvideLiquidity(
        deployer,
        deployer.ua,
        depositAmount,
        JPYUSDMarketIdx
      );

      await depositCollateralAndProvideLiquidity(
        alice,
        alice.ua,
        depositAmount,
        JPYUSDMarketIdx
      );

      const initialAliceUACollateral = await alice.vault.getBalance(
        alice.address,
        0
      );

      // make trading position go below margin requirement
      const timestampForkedMainnetBlock = 1639682285;
      const timestampJustBefore = timestampForkedMainnetBlock - 15;
      await bob.perpetual.__TestPerpetual_setGlobalPositionFundingRate(
        timestampJustBefore,
        utils.parseEther('100').mul(-1) // set very large negative cumFundingRate so that the position ends up below minMargin
      );

      const alicePosition = await alice.clearingHouseViewer.getTraderPosition(
        EURUSDMarketIdx,
        alice.address
      );
      const proposedAmount = getCloseProposedAmount(
        alicePosition,
        await getMarket(alice, EURUSDMarketIdx),
        alice.curveViews
      );
      await expect(
        bob.clearingHouse.liquidate(
          EURUSDMarketIdx,
          alice.address,
          proposedAmount,
          true
        )
      ).to.emit(alice.clearingHouse, 'LiquidationCall');

      const aliceUABalanceAfterFirstLiquidation = await alice.vault.getBalance(
        alice.address,
        0
      );

      expect(
        await alice.clearingHouseViewer.isMarginValid(alice.address, minMargin)
      ).to.be.false;

      // liquidate
      const aliceLPPositionBefore =
        await alice.clearingHouseViewer.getLpPosition(
          JPYUSDMarketIdx,
          alice.address
        );
      const proposedAmountToLiquidateLPPosition =
        await getLiquidityProviderProposedAmount(
          alice,
          aliceLPPositionBefore,
          aliceLPPositionBefore.liquidityBalance,
          JPYUSDMarketIdx
        );
      await expect(
        bob.clearingHouse.liquidate(
          JPYUSDMarketIdx,
          alice.address,
          proposedAmountToLiquidateLPPosition,
          false
        )
      ).to.emit(bob.clearingHouse, 'LiquidationCall');

      const aliceUABalanceAfterSecondLiquidation = await alice.vault.getBalance(
        alice.address,
        0
      );

      expect(aliceUABalanceAfterFirstLiquidation).to.be.lt(
        initialAliceUACollateral
      );
      expect(aliceUABalanceAfterSecondLiquidation).to.be.lt(
        aliceUABalanceAfterFirstLiquidation
      );
    });

    it('Calculate margin ratio of crypto market', async () => {
      const EURUSDMarketIdx = 0;
      const ETHUSDMarketIdx = 2;

      await deployJPYUSDMarket();
      await deployETHUSDMarket();

      await depositCollateralAndProvideLiquidity(
        lp,
        lp.ua,
        depositAmount,
        ETHUSDMarketIdx
      );

      await createUABalance([alice]);

      // open position on ETH_USD
      await alice.clearingHouse.changePosition(
        ETHUSDMarketIdx,
        tradeAmount.div(5),
        0,
        Side.Long
      );

      let reserveValue = await alice.vault.getReserveValue(
        alice.address,
        false
      );
      const ethPnL = await alice.clearingHouseViewer.getTraderUnrealizedPnL(
        ETHUSDMarketIdx,
        alice.address
      );
      const ethOpenNotional = (
        await alice.clearingHouseViewer.getTraderPosition(
          ETHUSDMarketIdx,
          alice.address
        )
      ).openNotional.abs();

      expect(await alice.clearingHouseViewer.marginRatio(alice.address)).to.eq(
        rDiv(reserveValue.add(ethPnL), ethOpenNotional.mul(3))
      );

      // open position on EUR_USD
      await alice.clearingHouse.changePosition(
        EURUSDMarketIdx,
        tradeAmount.div(5),
        0,
        Side.Long
      );

      reserveValue = await alice.vault.getReserveValue(alice.address, false);

      const eurPnl = await alice.clearingHouseViewer.getTraderUnrealizedPnL(
        EURUSDMarketIdx,
        alice.address
      );
      const eurOpenNotional = (
        await alice.clearingHouseViewer.getTraderPosition(
          EURUSDMarketIdx,
          alice.address
        )
      ).openNotional.abs();

      expect(await alice.clearingHouseViewer.marginRatio(alice.address)).to.eq(
        rDiv(
          reserveValue.add(ethPnL).add(eurPnl),
          ethOpenNotional.mul(3).add(eurOpenNotional)
        )
      );
    });
  });

  describe('Increment: Liquidate a multi-collateral position', () => {
    it('Should revert when user has a position open', async () => {
      await depositCollateralAndProvideLiquidity(lp, lp.ua, depositAmount);
      await alice.clearingHouse.changePosition(0, tradeAmount, 0, Side.Long);

      await expect(
        deployer.clearingHouse.seizeCollateral(alice.address)
      ).to.be.revertedWith(ClearingHouseErrors.SeizeCollateralStillOpen);
    });

    it('Should revert when no user debt', async () => {
      await expect(
        deployer.clearingHouse.seizeCollateral(alice.address)
      ).to.be.revertedWith(ClearingHouseErrors.LiquidationDebtSizeZero);
    });

    it('Should revert when user discounted non-UA balance larger than UA debt', async () => {
      await whiteListUSDCAsCollateral(deployer, env);

      // generate UA debt
      await alice.vault.__TestVault_change_trader_balance(
        alice.address,
        0,
        aliceAmount.mul(-3).div(2)
      );

      // deposit usdc
      await burnUA(alice, aliceAmount);
      await depositIntoVault(alice, alice.usdc, aliceAmount);

      await expect(
        deployer.clearingHouse.seizeCollateral(alice.address)
      ).to.be.revertedWith(ClearingHouseErrors.SufficientUserCollateral);
    });

    it('Should revert when user UA debt less than 10k', async () => {
      await whiteListUSDCAsCollateral(deployer, env);

      // generate UA debt
      await alice.vault.__TestVault_change_trader_balance(
        alice.address,
        0,
        aliceAmount.mul(-2)
      );

      // deposit usdc
      await burnUA(alice, aliceAmount.mul(2));
      await depositIntoVault(alice, alice.usdc, aliceAmount.mul(2));

      await expect(
        deployer.clearingHouse.seizeCollateral(alice.address)
      ).to.be.revertedWith(ClearingHouseErrors.SufficientUserCollateral);
    });

    it('Should seize one asset completely', async () => {
      await whiteListUSDCAsCollateral(deployer, env);

      // generate UA debt
      await alice.vault.__TestVault_change_trader_balance(
        alice.address,
        0,
        aliceAmount.mul(-2)
      );

      // deposit usdc
      await burnUA(alice, aliceAmount);
      await depositIntoVault(alice, alice.usdc, aliceAmount);

      expect(await alice.vault.getBalance(alice.address, 0)).to.be.eq(
        aliceAmount.mul(-1)
      );
      expect(await alice.vault.getBalance(alice.address, 1)).to.be.eq(
        aliceAmount
      );
      expect(await alice.vault.getReserveValue(alice.address, false)).to.be.eq(
        0
      );

      // seize collateral
      await bob.insurance.__TestInsurance_fundInsurance(depositAmount);
      const insuranceBalanceBefore = await lp.ua.balanceOf(
        lp.insurance.address
      );

      const balanceBefore = await deployer.ua.balanceOf(deployer.address);
      const discountedUSDCPrice = rMul(aliceAmount, liquidationDiscount);
      expect(balanceBefore).to.be.gt(discountedUSDCPrice);
      await deployer.ua.approve(alice.vault.address, discountedUSDCPrice);

      await expect(deployer.clearingHouse.seizeCollateral(alice.address))
        .to.emit(deployer.clearingHouse, 'SeizeCollateral')
        .withArgs(alice.address, deployer.address)
        .to.emit(deployer.vault, 'TraderBadDebtGenerated')
        .withArgs(alice.address, aliceAmount.sub(discountedUSDCPrice));

      // liquidatee balance change
      expect(await alice.vault.getBalance(alice.address, 0)).to.be.eq(0);
      expect(await alice.vault.getBalance(alice.address, 1)).to.be.eq(0);

      // liquidator balance change
      expect(await deployer.ua.balanceOf(deployer.address)).to.be.eq(
        balanceBefore.sub(discountedUSDCPrice)
      );
      expect(await deployer.vault.getBalance(deployer.address, 1)).to.be.eq(
        aliceAmount
      );

      // insurance balance change
      expect(await lp.ua.balanceOf(lp.insurance.address)).to.eq(
        insuranceBalanceBefore.sub(aliceAmount.sub(discountedUSDCPrice))
      );
    });

    async function depositTwoAssets() {
      // set up
      await whiteListUSDCAsCollateral(deployer, env);
      const token = await whiteListAsset(deployer, env);
      const aliceT = await addTokenToUser(alice, token, 'token');

      // deposit usdc
      await burnUA(aliceT, aliceAmount);
      await depositIntoVault(aliceT, aliceT.usdc, aliceAmount);

      // deposit token
      await aliceT.token.mint(aliceAmount);
      await depositIntoVault(aliceT, <IERC20Metadata>aliceT.token, aliceAmount);
    }

    it('Should seize two assets completely', async () => {
      await depositTwoAssets();

      // generate UA debt
      await alice.vault.__TestVault_change_trader_balance(
        alice.address,
        0,
        aliceAmount.mul(-3)
      );

      // seize collateral
      await bob.insurance.__TestInsurance_fundInsurance(depositAmount);
      const insuranceBalanceBefore = await lp.ua.balanceOf(
        lp.insurance.address
      );

      const balanceBefore = await deployer.ua.balanceOf(deployer.address);
      const discountedCollateralPrice = rMul(
        aliceAmount.mul(2),
        liquidationDiscount
      );
      expect(balanceBefore).to.be.gt(discountedCollateralPrice);
      await deployer.ua.approve(alice.vault.address, discountedCollateralPrice);

      const eUARemainingDebt = aliceAmount
        .mul(2)
        .sub(discountedCollateralPrice);
      await expect(deployer.clearingHouse.seizeCollateral(alice.address))
        .to.emit(deployer.clearingHouse, 'SeizeCollateral')
        .withArgs(alice.address, deployer.address)
        .to.emit(deployer.vault, 'TraderBadDebtGenerated')
        .withArgs(alice.address, eUARemainingDebt);

      // liquidatee balance change
      expect(await alice.vault.getBalance(alice.address, 0)).to.be.eq(0);
      expect(await alice.vault.getBalance(alice.address, 1)).to.be.eq(0);
      expect(await alice.vault.getBalance(alice.address, 2)).to.be.eq(0);

      // liquidator balance change
      expect(await deployer.ua.balanceOf(deployer.address)).to.be.eq(
        balanceBefore.sub(discountedCollateralPrice)
      );
      expect(await deployer.vault.getBalance(deployer.address, 1)).to.be.eq(
        aliceAmount
      );
      expect(await deployer.vault.getBalance(deployer.address, 2)).to.be.eq(
        aliceAmount
      );

      // insurance balance change
      expect(await lp.ua.balanceOf(lp.insurance.address)).to.eq(
        insuranceBalanceBefore.sub(eUARemainingDebt)
      );
    });

    it('Should seize one asset completely and one partially', async () => {
      await depositTwoAssets();

      // set very high collateral discount ratio to ensure user non-UA collaterals are seized
      await deployer.clearingHouse.setParameters({
        minMargin: await deployer.clearingHouse.minMargin(),
        minMarginAtCreation: await deployer.clearingHouse.minMarginAtCreation(),
        minPositiveOpenNotional:
          await deployer.clearingHouse.minPositiveOpenNotional(),
        liquidationReward: await deployer.clearingHouse.liquidationReward(),
        insuranceRatio: await deployer.clearingHouse.insuranceRatio(),
        liquidationRewardInsuranceShare:
          await deployer.clearingHouse.liquidationRewardInsuranceShare(),
        liquidationDiscount: await deployer.clearingHouse.liquidationDiscount(),
        nonUACollSeizureDiscount: ethers.utils.parseEther('0.05'),
        uaDebtSeizureThreshold:
          await deployer.clearingHouse.uaDebtSeizureThreshold(),
      });

      // generate UA debt
      await alice.vault.__TestVault_change_trader_balance(
        alice.address,

        0,
        aliceAmount.mul(-5).div(2) // -2.5
      );

      // prepare
      const balanceBefore = await deployer.ua.balanceOf(deployer.address);
      const uaAmountToSettle = aliceAmount.mul(3).div(2);

      expect(balanceBefore).to.be.gt(uaAmountToSettle);
      await deployer.ua.approve(alice.vault.address, uaAmountToSettle);

      /* Alice before liquidation:
        -> debt:   -1.5
        -> col1:    1 (0.95 Value)
        -> col2:    1 (0.95 Value)

        Alice after liquidation:
        -> debt:    0
        -> col1:    0
        -> col2:    1 + (- 1.5 + 0.95) (= -0.55) /  0.95 * 1
                <=> 1   - 0.55                   /  0.95 (= 0.5789)
                <=> 0.4211
      */

      const discountedCollateralPrice = rMul(aliceAmount, liquidationDiscount);
      const debtRemaining = uaAmountToSettle.sub(discountedCollateralPrice); // 0.55
      const shareOfCollateralTwoToSell = rDiv(
        debtRemaining,
        discountedCollateralPrice
      ); // 0.5789

      // seize collateral
      await expect(deployer.clearingHouse.seizeCollateral(alice.address))
        .to.emit(deployer.clearingHouse, 'SeizeCollateral')
        .withArgs(alice.address, deployer.address)
        .to.not.emit(deployer.vault, 'TraderBadDebtGenerated');

      // liquidatee balance change
      expect(await alice.vault.getBalance(alice.address, 0)).to.be.eq(0);
      expect(await alice.vault.getBalance(alice.address, 1)).to.be.eq(0);
      expect(await alice.vault.getBalance(alice.address, 2)).to.be.eq(
        rMul(aliceAmount, WAD.sub(shareOfCollateralTwoToSell))
      );

      // liquidator balance change
      expect(await deployer.ua.balanceOf(deployer.address)).to.be.eq(
        balanceBefore.sub(uaAmountToSettle)
      );
      expect(await deployer.vault.getBalance(deployer.address, 1)).to.be.eq(
        aliceAmount
      );
      expect(await deployer.vault.getBalance(deployer.address, 2)).to.be.eq(
        rMul(aliceAmount, shareOfCollateralTwoToSell)
      );
    });

    it('Should process seize USD value when asset not pegged to USD value', async () => {
      // set very high collateral discount ratio to ensure user non-UA collaterals are seized
      await deployer.clearingHouse.setParameters({
        minMargin: await deployer.clearingHouse.minMargin(),
        minMarginAtCreation: await deployer.clearingHouse.minMarginAtCreation(),
        minPositiveOpenNotional:
          await deployer.clearingHouse.minPositiveOpenNotional(),
        liquidationReward: await deployer.clearingHouse.liquidationReward(),
        insuranceRatio: await deployer.clearingHouse.insuranceRatio(),
        liquidationRewardInsuranceShare:
          await deployer.clearingHouse.liquidationRewardInsuranceShare(),
        liquidationDiscount: await deployer.clearingHouse.liquidationDiscount(),
        nonUACollSeizureDiscount: ethers.utils.parseEther('0.05'),
        uaDebtSeizureThreshold:
          await deployer.clearingHouse.uaDebtSeizureThreshold(),
      });

      // whitelist new `token` with fixed price of 2 & have Alice deposit `aliceAmount` of it in the Vault
      const token = await whiteListAsset(
        deployer,
        env,
        constants.WeiPerEther,
        utils.parseEther('2')
      );
      const aliceT = await addTokenToUser(alice, token, 'token');
      await aliceT.token.mint(aliceAmount);
      await depositIntoVault(aliceT, <IERC20Metadata>aliceT.token, aliceAmount);

      const initialCollateralBalance = await alice.vault.getBalance(
        alice.address,
        1
      );

      // generate UA debt
      // note: Alice starts with a UA balance worth `aliceAmount`
      await alice.vault.__TestVault_change_trader_balance(
        alice.address,
        0,
        aliceAmount.mul(-2)
      );

      // at this point, Alice vault looks like: +2aliceAmount of `token` & -aliceAmount of UA
      // note: token price is 2 so USD value of token balance is 2*aliceAmount

      /* Alice before liquidation:
        -> debt:   -1   USD
        -> col1:    2   USD (0.95 Value) = 1.9

        Alice after liquidation:
        -> debt:    0   USD
        -> col1:    0.9 USD

        Amount of col1 to sell to cover debt?
        amount * 0.95 = 1 <=> amount = 1 / 0.95
      */

      // compute UA amount
      const balanceBefore = await deployer.ua.balanceOf(deployer.address);
      const uaAmountToSettle = rDiv(aliceAmount, liquidationDiscount);
      expect(balanceBefore).to.be.gt(uaAmountToSettle);
      await deployer.ua.approve(deployer.vault.address, uaAmountToSettle);

      // compute token amount (in token unit)
      const undiscountedCollateralUSDValue = aliceAmount.mul(2);
      const collateralLiquidationValue = rMul(
        undiscountedCollateralUSDValue,
        liquidationDiscount
      );
      const debtSize = aliceAmount;
      const collateralSellRatio = rDiv(debtSize, collateralLiquidationValue);
      const collateralAmountToSell = rMul(
        initialCollateralBalance,
        collateralSellRatio
      );

      // seize collateral
      await expect(deployer.clearingHouse.seizeCollateral(alice.address))
        .to.emit(deployer.clearingHouse, 'SeizeCollateral')
        .withArgs(alice.address, deployer.address)
        .to.not.emit(deployer.vault, 'TraderBadDebtGenerated');

      // liquidatee balance change
      expect(await alice.vault.getBalance(alice.address, 0)).to.be.eq(0);
      expect(await alice.vault.getBalance(alice.address, 1)).to.be.eq(
        initialCollateralBalance.sub(collateralAmountToSell)
      );

      // liquidator balance change
      expect(await deployer.ua.balanceOf(deployer.address)).to.be.eq(
        balanceBefore.sub(debtSize)
      );
      expect(await deployer.vault.getBalance(deployer.address, 1)).to.be.eq(
        collateralAmountToSell
      );
    });
  });
});
