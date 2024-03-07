import env, {ethers} from 'hardhat';
import {expect} from 'chai';

// helpers
import {setup, createUABalance, User} from '../helpers/setup';

import {getChainlinkPrice} from '../../helpers/contracts-getters';
import {
  getLatestTimestamp,
  increaseTimeAndMine,
  revertTimeAndSnapshot,
} from '../../helpers/misc-utils';

import {BigNumber} from 'ethers';
import {Side} from '../helpers/utils/types';
import {DEAD_ADDRESS} from '../../helpers/constants';

import {asBigNumber, rDiv, rMul} from '../helpers/utils/calculations';

import {
  addUSDCCollateralAndUSDCBalanceToUsers,
  extendPositionWithCollateral,
  depositCollateralAndProvideLiquidity,
  removeLiquidity,
  closePosition,
  depositIntoVault,
} from '../helpers/PerpetualUtilsFunctions';

import {
  getLpProfit,
  getLiquidityProviderProposedAmount,
  getTokensToWithdraw,
  getLpPositionAfterWithdrawal,
  getLiquidityProviderProposedAmountContract,
} from '../helpers/LiquidityGetters';

import {
  getCloseProposedAmount,
  getCloseTradeDirection,
  get_dy,
} from '../helpers/TradingGetters';
import {minutes} from '../../helpers/time';
import {formatEther, parseEther} from 'ethers/lib/utils';
import {ClearingHouseErrors, PerpetualErrors} from '../../helpers/errors';

import {takeOverAndFundAccountSetupUser} from '../helpers/AccountUtils';

describe('Increment App: Liquidity', function () {
  let deployer: User, lp: User, lpTwo: User, trader: User;
  let liquidityAmount: BigNumber;

  beforeEach('Set up', async () => {
    ({deployer, lp, trader, lpTwo} = await setup());

    liquidityAmount = await createUABalance([lp, trader, lpTwo]);
    await lp.ua.approve(lp.vault.address, liquidityAmount);
    await lpTwo.ua.approve(lpTwo.vault.address, liquidityAmount);
    await trader.ua.approve(trader.vault.address, liquidityAmount);
  });

  async function generateTradingFees(user: User, direction: Side = Side.Long) {
    // trade some assets to change the ratio in the pool
    const tradeAmount = liquidityAmount.div(100);

    await extendPositionWithCollateral(
      user,
      user.ua,
      tradeAmount,
      tradeAmount,
      direction
    );
    await closePosition(user, user.ua);

    const global = await user.perpetual.getGlobalPosition();
    expect(global.totalTradingFeesGrowth).to.be.gt(0);
    expect(global.totalBaseFeesGrowth).to.be.gt(0);
    expect(global.totalQuoteFeesGrowth).to.be.gt(0);
  }

  describe('Can deposit liquidity to the curve pool', function () {
    it('Should not allow to deposit zero', async function () {
      await lp.clearingHouse.deposit(liquidityAmount, lp.ua.address);

      await expect(
        lp.clearingHouse.provideLiquidity(0, [0, 0], 0)
      ).to.be.revertedWith(ClearingHouseErrors.ProviderLiquidityZeroAmount);
    });

    it('Should not allow to deposit too much', async function () {
      const maxDeposit = formatEther(await lp.perpetual.maxLiquidityProvided());
      const tooLargeDeposit = (await createUABalance([lp], +maxDeposit)).add(1);
      await lp.ua.approve(lp.vault.address, tooLargeDeposit);

      await lp.clearingHouse.deposit(tooLargeDeposit, lp.ua.address);

      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [
            tooLargeDeposit,
            rDiv(tooLargeDeposit, await lp.perpetual.indexPrice()),
          ],
          0
        )
      ).to.be.revertedWith(PerpetualErrors.MaxLiquidityProvided);

      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [
            tooLargeDeposit.sub(1),
            rDiv(tooLargeDeposit.sub(1), await lp.perpetual.indexPrice()),
          ],
          0
        )
      ).to.not.be.reverted;
    });

    it('Provided Liquidity should not exceed free collateral', async function () {
      await lp.clearingHouse.deposit(liquidityAmount, lp.ua.address);

      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [
            liquidityAmount.add(2),
            rDiv(liquidityAmount, await lp.perpetual.indexPrice()),
          ],
          0
        )
      ).to.be.revertedWith(ClearingHouseErrors.AmountProvidedTooLarge);

      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [
            liquidityAmount,
            rDiv(liquidityAmount, await lp.perpetual.indexPrice()).add(2),
          ],
          0
        )
      ).to.be.revertedWith(ClearingHouseErrors.AmountProvidedTooLarge);

      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [
            liquidityAmount,
            rDiv(liquidityAmount, await lp.perpetual.indexPrice()),
          ],
          0
        )
      ).to.not.be.reverted;
    });

    it('Should return 0 to position after withdraw if LP has no opened position', async function () {
      const emptyPosition = await lp.perpetual.getLpPositionAfterWithdrawal(
        lp.address
      );

      expect(emptyPosition.openNotional).to.eq(0);
      expect(emptyPosition.positionSize).to.eq(0);
      expect(emptyPosition.cumFundingRate).to.eq(0);
    });

    it('Should not allow to withdraw too much', async function () {
      await lp.clearingHouse.deposit(liquidityAmount, lp.ua.address);

      await lp.clearingHouse.provideLiquidity(
        0,
        [
          liquidityAmount,
          rDiv(liquidityAmount, await lp.perpetual.indexPrice()),
        ],
        0
      );

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const liquidityProviderPosition =
        await lp.clearingHouseViewer.getLpPosition(0, lp.address);

      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          liquidityProviderPosition.liquidityBalance,
          [0, 0],
          0,
          0
        )
      ).to.be.revertedWith(PerpetualErrors.MarketBalanceTooLow);
    });

    it('Should allow to deposit and provide liquidity as independent steps', async function () {
      await lp.clearingHouse.deposit(liquidityAmount, lp.ua.address);

      expect(await lp.ua.balanceOf(lp.address)).to.be.equal(0);
      expect(await lp.ua.balanceOf(lp.vault.address)).to.be.equal(
        liquidityAmount
      );

      expect(await lp.perpetual.isLpPositionOpen(lp.address)).to.eq(false);

      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [
            liquidityAmount,
            rDiv(liquidityAmount, await lp.perpetual.indexPrice()),
          ],
          0
        )
      )
        .to.emit(lp.clearingHouse, 'LiquidityProvided')
        .withArgs(
          0,
          lp.address,
          liquidityAmount,
          rDiv(liquidityAmount, await lp.perpetual.indexPrice())
        );

      expect(await lp.perpetual.isLpPositionOpen(lp.address)).to.eq(true);
    });

    it('Should allow to deposit twice', async function () {
      await lp.clearingHouse.deposit(liquidityAmount.div(2), lp.ua.address);

      await lp.clearingHouse.provideLiquidity(
        0,
        [
          liquidityAmount.div(2),
          rDiv(liquidityAmount.div(2), await lp.perpetual.indexPrice()),
        ],
        0
      );

      await lp.clearingHouse.deposit(liquidityAmount.div(2), lp.ua.address);

      await lp.clearingHouse.provideLiquidity(
        0,
        [
          liquidityAmount.div(2).sub(2),
          rDiv(liquidityAmount.div(2), await lp.perpetual.indexPrice()).sub(2),
        ], // -2 because curve imprecision
        0
      );
    });

    it('Should split first deposit with ratio from chainlink price', async function () {
      // before you deposit
      const vBaseBefore = await lp.vBase.balanceOf(lp.market.address);
      const vQuoteBefore = await lp.vQuote.balanceOf(lp.market.address);
      const vBaselpBalance = await lp.market.balances(1);
      const vQuotelpBalance = await lp.market.balances(0);

      const price = await getChainlinkPrice(env, 'EUR_USD');

      expect(vBaseBefore).to.be.equal(vBaselpBalance);
      expect(vQuoteBefore).to.be.equal(vQuotelpBalance);

      // deposit
      await lp.clearingHouse.deposit(liquidityAmount, lp.ua.address);
      await lp.clearingHouse.provideLiquidity(
        0,
        [liquidityAmount, rDiv(liquidityAmount, price)],
        0
      );

      // after you deposit
      /* relative price should not change */
      expect(await lp.perpetual.marketPrice()).to.be.equal(price);

      /* balances should increment */
      expect(await lp.vQuote.balanceOf(lp.market.address)).to.be.equal(
        vQuoteBefore.add(liquidityAmount)
      );
      expect(await lp.vBase.balanceOf(lp.market.address)).to.be.equal(
        vBaseBefore.add(rDiv(liquidityAmount, price))
      );
      expect(await lp.market.balances(0)).to.be.equal(
        vQuotelpBalance.add(liquidityAmount)
      );
      expect(await lp.market.balances(1)).to.be.equal(
        vBaselpBalance.add(rDiv(liquidityAmount, price))
      );

      /* should have correct balance in perpetual */
      const lpBalance = await lp.perpetual.getLpPosition(lp.address);
      expect(lpBalance.openNotional.mul(-1)).to.be.equal(liquidityAmount);
      expect(lpBalance.positionSize.mul(-1)).to.be.equal(
        rDiv(liquidityAmount, price)
      );

      expect(lpBalance.liquidityBalance).to.be.equal(
        await lp.curveToken.balanceOf(lp.perpetual.address)
      );
      expect(await lp.perpetual.getTotalLiquidityProvided()).to.be.equal(
        await lp.curveToken.balanceOf(lp.perpetual.address)
      );
    });

    it('Should allow multiple deposits from one account', async function () {
      // lp deposits some assets
      await depositCollateralAndProvideLiquidity(
        lp,
        lp.ua,
        liquidityAmount.div(2)
      );

      // trade some assets to change the ratio in the pool
      expect(await lp.perpetual.getLpTradingFees(lp.address)).to.eq(0);
      const depositAmount = liquidityAmount.div(200);
      await trader.clearingHouse.deposit(depositAmount, trader.ua.address);

      const {dyInclFees} = await get_dy(
        trader.curveViews,
        trader.market,
        depositAmount.mul(2),
        0,
        1
      );

      await trader.clearingHouse.changePosition(
        0,
        depositAmount.mul(2),
        0,
        Side.Long
      );
      expect(await lp.perpetual.getLpTradingFees(lp.address)).to.gt(0);

      // before depositing more liquidity
      const vBaseBefore = await lp.vBase.balanceOf(lp.market.address);
      const vQuoteBefore = await lp.vQuote.balanceOf(lp.market.address);
      const vBaselpBalance = await lp.market.balances(1);
      const vQuotelpBalance = await lp.market.balances(0);
      expect(vBaseBefore).to.be.equal(vBaselpBalance);
      expect(vQuoteBefore).to.be.equal(vQuotelpBalance);

      const priceBefore = await lp.perpetual.indexPrice();

      const lpPosition = await lp.perpetual.getLpPosition(lp.address);
      const globalPosition = await lp.perpetual.getGlobalPosition();
      expect(lpPosition.totalTradingFeesGrowth).to.lt(
        globalPosition.totalTradingFeesGrowth
      );
      const tokensFromSimulatedWithdrawable = await getTokensToWithdraw(
        lpPosition,
        globalPosition,
        lp.market
      );
      const baseFeesToBeBurned =
        tokensFromSimulatedWithdrawable.withdrawnBaseTokens.sub(
          tokensFromSimulatedWithdrawable.withdrawnBaseTokensExFees
        );

      // deposit more liquidity
      await depositCollateralAndProvideLiquidity(
        lp,
        lp.ua,
        liquidityAmount.div(2)
      );

      /* trading fee index should be resetted */

      expect(
        (await lp.perpetual.getLpPosition(lp.address)).totalTradingFeesGrowth
      ).to.eq((await lp.perpetual.getGlobalPosition()).totalTradingFeesGrowth);
      expect(await lp.perpetual.getLpTradingFees(lp.address)).to.eq(0);

      /* balances should increment */
      expect(await lp.vQuote.balanceOf(lp.market.address)).to.be.equal(
        vQuoteBefore.add(liquidityAmount.div(2))
      );
      expect(await lp.vBase.balanceOf(lp.market.address)).to.be.equal(
        vBaseBefore
          .add(rDiv(liquidityAmount.div(2), priceBefore))
          .sub(baseFeesToBeBurned)
      );
      expect(await lp.market.balances(1)).to.be.equal(
        vBaselpBalance
          .add(rDiv(liquidityAmount.div(2), priceBefore))
          .sub(baseFeesToBeBurned)
      );
      expect(await lp.market.balances(0)).to.be.equal(
        vQuotelpBalance.add(liquidityAmount.div(2))
      );

      /* should have correct balance in perpetual */
      const lpBalance = await lp.perpetual.getLpPosition(lp.address);
      expect(lpBalance.openNotional.mul(-1)).to.be.equal(
        vQuoteBefore.add(liquidityAmount.div(2)).sub(depositAmount.mul(2)) // initial vQuote amount (excl. fees)
      );

      expect(lpBalance.positionSize.mul(-1)).to.be.equal(
        vBaseBefore
          .add(rDiv(liquidityAmount.div(2), priceBefore))
          .add(dyInclFees) /* vBase balance */
      );

      expect(lpBalance.liquidityBalance).to.be.equal(
        await lp.curveToken.balanceOf(lp.perpetual.address)
      );
      expect(await lp.perpetual.getTotalLiquidityProvided()).to.be.equal(
        await lp.curveToken.balanceOf(lp.perpetual.address)
      );
    });

    it('Should allow to deposit with desired proportions', async function () {
      // lp deposits some assets
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // trade some assets to change the ratio in the pool
      const depositAmount = liquidityAmount.div(100);
      await trader.clearingHouse.deposit(depositAmount, trader.ua.address);
      await trader.clearingHouse.changePosition(
        0,
        depositAmount.mul(2),
        0,
        Side.Long
      );

      // deposit some collateral
      await depositIntoVault(lpTwo, lpTwo.ua, liquidityAmount);

      // provide liquidity
      const quoteAmount = liquidityAmount.div(100);

      /*

      a - b = b * 10%
      a     = b * 10% + b
      */

      // upper bound
      const maxBaseAmountInQuote = quoteAmount.add(quoteAmount.div(10));
      const maxBaseAmount = rDiv(
        maxBaseAmountInQuote,
        await lp.perpetual.indexPrice()
      );
      await expect(
        lp.clearingHouse.provideLiquidity(0, [quoteAmount, maxBaseAmount], 0)
      ).to.not.be.reverted;
      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [quoteAmount, maxBaseAmount.add(1)],
          0
        )
      ).to.be.revertedWith(PerpetualErrors.LpAmountDeviation);

      // lower bound
      const minBaseAmountInQuote = quoteAmount.sub(quoteAmount.div(10));
      const minBaseAmount = rDiv(
        minBaseAmountInQuote,
        await lp.perpetual.indexPrice()
      );
      await expect(
        lp.clearingHouse.provideLiquidity(0, [quoteAmount, minBaseAmount], 0)
      ).to.not.be.reverted;
      await expect(
        lp.clearingHouse.provideLiquidity(
          0,
          [quoteAmount, minBaseAmount.sub(1)],
          0
        )
      ).to.be.revertedWith(PerpetualErrors.LpAmountDeviation);
    });
  });
  describe('Can withdraw liquidity from the curve pool', function () {
    it('Should not allow to withdraw liquidity when none provided', async function () {
      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      await expect(
        lp.clearingHouse.removeLiquidity(0, asBigNumber('1'), [0, 0], 0, 0)
      ).to.be.revertedWith(PerpetualErrors.LPWithdrawExceedsBalance);
    });

    it('Should allow not to withdraw more liquidity than provided', async function () {
      // deposit
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // try withdraw

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const providedLiquidity = (await lp.perpetual.getLpPosition(lp.address))
        .liquidityBalance;

      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          providedLiquidity.add(BigNumber.from('1')),
          [0, 0],
          0,
          0
        )
      ).to.be.revertedWith(PerpetualErrors.LPWithdrawExceedsBalance);
    });

    it('Should revert withdrawal if not enough liquidity in the pool', async function () {
      // deposit
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // withdraw token liquidity from pool

      /* take over curve pool & fund with ether*/
      const marketAccount = await takeOverAndFundAccountSetupUser(
        lp.market.address
      );

      /* withdraw liquidity from curve pool*/
      await marketAccount.vBase.transfer(
        DEAD_ADDRESS,
        await lp.vBase.balanceOf(lp.market.address)
      );
      expect(await lp.vBase.balanceOf(lp.market.address)).to.be.equal(0);

      // try withdrawal from pool:
      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          (
            await lp.perpetual.getLpPosition(lp.address)
          ).liquidityBalance,
          [0, 0],
          0,
          0
        )
      ).to.be.revertedWith('');
    });

    it('Should revert withdrawal when time lock is not reached', async function () {
      // deposit
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // add extra liquidity else, the amounts of lp.openNotional and lp.positionSize are too small (respectively -2
      // and -1) for market.exchange to work when closing the PnL of the position
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );

      // withdraw
      const lpPosition = await lpTwo.perpetual.getLpPosition(lpTwo.address);
      await expect(
        lpTwo.clearingHouse.removeLiquidity(
          0,
          lpPosition.liquidityBalance,
          [0, 0],
          await getLiquidityProviderProposedAmount(lp, lpPosition),
          0
        )
      ).to.be.revertedWith(PerpetualErrors.LockPeriodNotReached);

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      await expect(
        lpTwo.clearingHouse.removeLiquidity(
          0,
          lpPosition.liquidityBalance,
          [0, 0],
          await getLiquidityProviderProposedAmount(lp, lpPosition),
          0
        )
      ).to.not.be.reverted;
    });

    it('Should allow to remove liquidity from pool, emit event', async function () {
      // deposit
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // add extra liquidity else, the amounts of lp.openNotional and lp.positionSize are too small (respectively -2
      // and -1) for market.exchange to work when closing the PnL of the position
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      // withdraw

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const lpPosition = await lpTwo.perpetual.getLpPosition(lpTwo.address);

      const proposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        lpPosition
      );

      const perpetualVQuoteAmountBeforeWithdraw = await lpTwo.vQuote.balanceOf(
        lpTwo.perpetual.address
      );

      await lpTwo.clearingHouse.removeLiquidity(
        0,
        lpPosition.liquidityBalance,
        [0, 0],
        proposedAmount,
        0
      );

      const perpetualVQuoteAmountAfterWithdraw = await lpTwo.vQuote.balanceOf(
        lpTwo.perpetual.address
      );

      expect(perpetualVQuoteAmountBeforeWithdraw).to.eq(
        perpetualVQuoteAmountAfterWithdraw
      );
    });

    it('Should remove and withdraw liquidity from pool, then delete LP position', async function () {
      // deposit
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // add extra liquidity else, the amounts of lp.openNotional and lp.positionSize are too small (respectively -2
      // and -1) for market.exchange to work when closing the PnL of the position
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      // withdraw
      await removeLiquidity(lp);

      const positionAfter = await lp.perpetual.getLpPosition(lp.address);
      // everything should be set to 0
      expect(positionAfter.liquidityBalance).to.be.equal(0);
      expect(positionAfter.cumFundingRate).to.be.equal(0);
      expect(positionAfter.positionSize).to.be.equal(0);
      expect(positionAfter.openNotional).to.be.equal(0);
    });

    it('Should allow LP to remove liquidity partially', async function () {
      // deposit
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // add extra liquidity else, the amounts of lp.openNotional and lp.positionSize are too small (respectively -2
      // and -1) for market.exchange to work when closing the PnL of the position
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );

      // set a non-zero value to the trading fees global state
      const globalTradingFeesBeforeFirstWithdrawal = asBigNumber('0.001');
      await lp.perpetual.__TestPerpetual_setGlobalPositionTradingFees(
        globalTradingFeesBeforeFirstWithdrawal
      );

      // first partial withdraw
      const initialLpPosition = await lp.perpetual.getLpPosition(lp.address);

      expect(await lp.perpetual.getLpTradingFees(lp.address)).to.eq(
        rMul(
          initialLpPosition.openNotional.abs(),
          globalTradingFeesBeforeFirstWithdrawal
        )
      );

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const firstProposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        initialLpPosition,
        initialLpPosition.liquidityBalance.div(2),
        0
      );

      await lp.clearingHouse.removeLiquidity(
        0,
        initialLpPosition.liquidityBalance.div(2),
        [0, 0],
        firstProposedAmount,
        0
      );

      const positionAfterFirstWithdrawal = await lp.perpetual.getLpPosition(
        lp.address
      );
      const globalPosition = await lp.perpetual.getGlobalPosition();
      expect(positionAfterFirstWithdrawal.totalTradingFeesGrowth).to.eq(
        globalTradingFeesBeforeFirstWithdrawal
      );
      expect(await lp.perpetual.getLpTradingFees(lp.address)).to.eq(
        rMul(
          positionAfterFirstWithdrawal.openNotional.abs(),
          globalPosition.totalTradingFeesGrowth.sub(
            positionAfterFirstWithdrawal.totalTradingFeesGrowth
          )
        )
      );

      // second withdraw, full withdraw this time

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const secondLpPosition = await lp.perpetual.getLpPosition(lp.address);
      const secondProposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        secondLpPosition,
        secondLpPosition.liquidityBalance,
        0
      );

      await lp.clearingHouse.removeLiquidity(
        0,
        secondLpPosition.liquidityBalance,
        [0, 0],
        secondProposedAmount,
        0
      );

      const positionAfterSecondWithdrawal = await lp.perpetual.getLpPosition(
        lp.address
      );

      // everything should now be set to 0
      expect(positionAfterSecondWithdrawal.liquidityBalance).to.be.equal(0);
      expect(positionAfterSecondWithdrawal.cumFundingRate).to.be.equal(0);
      expect(positionAfterSecondWithdrawal.positionSize).to.be.equal(0);
      expect(positionAfterSecondWithdrawal.openNotional).to.be.equal(0);
      expect(positionAfterSecondWithdrawal.totalTradingFeesGrowth).to.be.equal(
        0
      );
    });

    async function setPrice(user: User, price: BigNumber) {
      await (
        await user.perpetual.__TestPerpetual_setTWAP(
          price,
          await user.perpetual.oracleTwap()
        )
      ).wait();
    }

    async function driveDownMarketPrice(user: User) {
      // drive down market price (to change ratios in the pool)
      await user.perpetual.__TestPerpetual_manipulate_market(
        1,
        0,
        asBigNumber('1000')
      );

      // important: set new blockLastPrice / twap to circumvent trade restrictions
      await setPrice(user, await user.perpetual.marketPrice());
    }

    async function driveUpMarketPrice(user: User) {
      // drive up market price (to change ratios in the pool)
      await user.perpetual.__TestPerpetual_manipulate_market(
        0,
        1,
        asBigNumber('1000')
      );

      // important: set new blockLastPrice / twap to circumvent trade restrictions
      await setPrice(user, await user.perpetual.marketPrice());
    }

    it('Liquidity provider generate profit (loss) in USD (EUR) when EUR/USD goes up', async function () {
      /* TODO: find out if the loss can exceed the collateral (under realistic conditions)
                 is most likely easier with fuzzing
        */
      // init
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);
      await depositCollateralAndProvideLiquidity(
        trader,
        trader.ua,
        liquidityAmount
      );

      // deposit initial liquidity
      const liquidityAmountTwo = liquidityAmount.div(1000); // small amount to avoid trade restrictions
      const lpBalanceBefore = await lpTwo.ua.balanceOf(lpTwo.address);
      const lpBalanceBeforeEUR = rDiv(
        lpBalanceBefore,
        await lp.perpetual.marketPrice()
      );

      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lp.ua,
        liquidityAmountTwo
      );

      // change market prices
      await driveUpMarketPrice(lpTwo);

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      // withdraw liquidity
      await removeLiquidity(lpTwo);

      // everything should now be set to 0
      const positionAfter = await lpTwo.perpetual.getLpPosition(lpTwo.address);
      expect(positionAfter.liquidityBalance).to.be.equal(0);
      expect(positionAfter.positionSize).to.be.equal(0);
      expect(positionAfter.cumFundingRate).to.be.equal(0);
      expect(positionAfter.openNotional).to.be.equal(0);

      // USD profit
      const lpUSDBalanceAfter = await lpTwo.ua.balanceOf(lpTwo.address);
      //  expect(lpUSDBalanceAfter).to.be.gt(lpBalanceBefore);

      // EUR loss
      const lpBalanceAfterEUR = rDiv(
        lpUSDBalanceAfter,
        await lp.perpetual.marketPrice()
      );
      expect(lpBalanceAfterEUR).to.be.lt(lpBalanceBeforeEUR);
    });

    it('Liquidity provider can generate a loss (in USD) when EUR/USD goes down', async function () {
      /* TODO: find out if the loss can exceed the collateral (under realistic conditions)
                 is most likely easier with fuzzing
        */
      // init
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);
      await depositCollateralAndProvideLiquidity(
        trader,
        trader.ua,
        liquidityAmount
      );

      // deposit initial liquidity
      const liquidityAmountTwo = liquidityAmount.div(1000); // small amount to avoid trade restrictions
      const lpBalanceBefore = await lpTwo.ua.balanceOf(lpTwo.address);

      const lpBalanceBeforeEUR = rDiv(
        lpBalanceBefore,
        await lp.perpetual.marketPrice()
      );

      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lp.ua,
        liquidityAmountTwo
      );

      // change market prices
      await driveDownMarketPrice(lpTwo);

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      // withdraw liquidity
      await removeLiquidity(lpTwo);

      // everything should now be set to 0
      const positionAfter = await lpTwo.perpetual.getLpPosition(lpTwo.address);
      expect(positionAfter.liquidityBalance).to.be.equal(0);
      expect(positionAfter.positionSize).to.be.equal(0);
      expect(positionAfter.cumFundingRate).to.be.equal(0);
      expect(positionAfter.openNotional).to.be.equal(0);

      // USD profit
      const lpBalanceAfter = await lpTwo.ua.balanceOf(lpTwo.address);
      expect(lpBalanceAfter).to.be.lt(lpBalanceBefore);

      // EUR loss
      const lpBalanceAfterEUR = rDiv(
        lpBalanceAfter,
        await lp.perpetual.marketPrice()
      );
      expect(lpBalanceAfterEUR).to.be.gt(lpBalanceBeforeEUR);
    });

    it('Should revert when not enough liquidity tokens are minted', async function () {
      // init
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // provide liquidity uses minAmount
      const providedLiquidityArray = [
        liquidityAmount,
        rDiv(liquidityAmount, await lp.market.last_prices()),
      ] as [BigNumber, BigNumber];
      const eLpTokens = await lp.market.calc_token_amount(
        providedLiquidityArray
      );
      await lpTwo.ua.approve(lpTwo.vault.address, liquidityAmount);

      await lpTwo.clearingHouse.deposit(liquidityAmount, lpTwo.ua.address);
      await expect(
        lpTwo.clearingHouse.provideLiquidity(
          0,
          providedLiquidityArray,
          eLpTokens.add(1).add(1) // add 1 wei since one wei is subtracted inside curve
        )
      ).to.be.revertedWith('');

      await expect(
        lpTwo.clearingHouse.provideLiquidity(
          0,
          providedLiquidityArray,
          eLpTokens
        )
      ).to.not.be.reverted;
    });

    it('Should revert when not enough virtual tokens are released', async function () {
      // init
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // attempt withdrawal

      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const lpPosition = await lp.perpetual.getLpPosition(lp.address);

      const eWithdrawnQuoteTokens = (await lp.market.balances(0))
        .mul(lpPosition.liquidityBalance)
        .div(await lp.perpetual.getTotalLiquidityProvided())
        .sub(1);
      const eWithdrawnBaseTokens = (await lp.market.balances(1))
        .mul(lpPosition.liquidityBalance)
        .div(await lp.perpetual.getTotalLiquidityProvided())
        .sub(1);

      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          lpPosition.liquidityBalance,
          [eWithdrawnQuoteTokens.add(1), eWithdrawnBaseTokens.add(1)],
          0,
          0
        )
      ).to.be.revertedWith('');

      const proposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        lpPosition
      );

      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          lpPosition.liquidityBalance,
          [eWithdrawnQuoteTokens, eWithdrawnBaseTokens],
          proposedAmount,
          0
        )
      ).to.not.be.reverted;
    });
  });
  describe('Should correctly calculate the profit of liquidity providers ', function () {
    async function checkProfit(time: number, tradeDirection: Side) {
      // set-up
      const balanceBefore = await lp.ua.balanceOf(lp.address);
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );

      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);
      await generateTradingFees(trader, tradeDirection);

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      // set time
      let snapshotId = await env.network.provider.send('evm_snapshot', []);
      const newTime = (await getLatestTimestamp(env)) + time;
      const eTime = BigNumber.from(newTime).add(1); // add 1s here for tx

      // calculate expected profit
      snapshotId = await revertTimeAndSnapshot(env, snapshotId, newTime);
      const eProfit = await getLpProfit(lp, eTime);

      // close position
      const lpPosition = await lp.clearingHouseViewer.getLpPosition(
        0,
        lp.address
      );

      snapshotId = await revertTimeAndSnapshot(env, snapshotId, newTime);
      const proposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        lpPosition
      );

      await revertTimeAndSnapshot(env, snapshotId, newTime);
      const tx = await lp.clearingHouse.removeLiquidity(
        0,
        lpPosition.liquidityBalance,
        [0, 0],
        proposedAmount,
        0
      );

      // check time passed
      const receipts = await tx.wait(0);
      const block = await env.ethers.provider.getBlock(receipts.blockNumber);
      expect(block.timestamp).to.be.equal(eTime.toNumber());

      // check profit
      await lp.clearingHouse.withdraw(
        await lp.vault.getBalance(lp.address, 0), // decimals match here
        lp.ua.address
      );

      const balanceAfter = await lp.ua.balanceOf(lp.address);

      expect(balanceAfter).to.be.eq(balanceBefore.add(eProfit));
    }

    it('3 min && long', async function () {
      await checkProfit(minutes(3), Side.Long);
    });
    it('33 min && long', async function () {
      await checkProfit(minutes(33), Side.Long);
    });
    it('3 min && short', async function () {
      await checkProfit(minutes(3), Side.Short);
    });
    it('33 min && short', async function () {
      await checkProfit(minutes(33), Side.Short);
    });
  });

  describe('Misc', async function () {
    it('Should emit provide liquidity event in the curve pool', async function () {
      const price = await lp.perpetual.indexPrice(); // valid for first deposit

      const PRECISION = asBigNumber('1');
      await lp.clearingHouse.deposit(liquidityAmount, lp.ua.address);
      await expect(
        await lp.clearingHouse.provideLiquidity(
          0,
          [liquidityAmount, liquidityAmount.mul(PRECISION).div(price)],
          0
        )
      )
        .to.emit(lp.market, 'AddLiquidity')
        .withArgs(
          lp.perpetual.address,
          [liquidityAmount, liquidityAmount.mul(PRECISION).div(price)],
          0,
          0
        );
    });
  });

  describe('Dust', function () {
    it('Trade actions should generate dust', async function () {
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      await extendPositionWithCollateral(
        trader,
        trader.ua,
        liquidityAmount.div(100),
        liquidityAmount.div(20),
        Side.Short
      );

      await depositCollateralAndProvideLiquidity(lpTwo, lp.ua, liquidityAmount);

      // closing position generates dust
      const eBaseDust = BigNumber.from('8');
      const traderPosition = await trader.perpetual.getTraderPosition(
        trader.address
      );

      // hardcode proposed amount to eliminate time dependency
      const closeProposedAmount = await getCloseProposedAmount(
        traderPosition,
        trader.market,
        trader.curveViews
      );

      await expect(
        trader.clearingHouse.changePosition(
          0,
          closeProposedAmount.add(10),
          0,
          getCloseTradeDirection(traderPosition)
        )
      ).to.emit(trader.perpetual, 'DustGenerated');

      expect(await lp.clearingHouseViewer.getBaseDust(0)).to.be.closeTo(
        (await lp.perpetual.getTraderPosition(lp.clearingHouse.address))
          .positionSize,
        1
      );
      expect(await lp.clearingHouseViewer.getBaseDust(0)).to.be.closeTo(
        eBaseDust,
        1
      );
    });
    it('LP actions should generate dust', async function () {
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      await extendPositionWithCollateral(
        trader,
        trader.ua,
        liquidityAmount.div(1000),
        liquidityAmount.div(200),
        Side.Short
      );

      await depositCollateralAndProvideLiquidity(lpTwo, lp.ua, liquidityAmount);

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      // get proposed amount
      const snapshotId = await env.network.provider.send('evm_snapshot', []);
      const newTime = (await getLatestTimestamp(env)) + 1;
      const lpPosition = await lp.perpetual.getLpPosition(lp.address);
      const proposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        lpPosition
      );

      // withdraw liquidity
      await revertTimeAndSnapshot(env, snapshotId, newTime);
      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          lpPosition.liquidityBalance,
          [0, 0],
          proposedAmount.sub(1),
          0
        )
      )
        .to.emit(trader.perpetual, 'DustGenerated')
        .withArgs(1);
    });
  });

  describe('Curve admin fees', function () {
    it('Curve claims no fees from the pool', async function () {
      // setup
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);
      await generateTradingFees(trader);
      const poolFeeReceiver = await lp.factory.fee_receiver();

      // profit before
      const virtualPriceBefore = await lp.market.virtual_price();
      const xpcProfitBefore = await lp.market.xcp_profit();
      expect(xpcProfitBefore).to.be.gt(0);
      expect(await lp.curveToken.balanceOf(poolFeeReceiver)).to.be.eq(0);

      // zero admin fees should be claimed here
      await expect(lp.market.claim_admin_fees()).to.not.emit(
        lp.market,
        'ClaimAdminFee'
      );
      expect(await lp.market.xcp_profit()).to.be.eq(
        await lp.market.xcp_profit_a()
      );
      expect(await lp.market.virtual_price()).to.be.eq(virtualPriceBefore);
      expect(await lp.market.xcp_profit()).to.be.eq(xpcProfitBefore);
      expect(await lp.curveToken.balanceOf(poolFeeReceiver)).to.be.eq(0);
    });
  });

  describe('Revert Helpers', function () {
    it('Should ensure removeLiquiditySwap always reverts', async function () {
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      const globalPosition = await lp.perpetual.getGlobalPosition();
      const lpPosition = await lp.perpetual.getLpPosition(lp.address);
      const lpPositionAfterWithdraw = await getLpPositionAfterWithdrawal(
        lpPosition,
        globalPosition,
        lp.market
      );

      const eWithdrawnQuoteTokens = (await lp.market.balances(0))
        .mul(lpPosition.liquidityBalance)
        .div(await lp.perpetual.getTotalLiquidityProvided())
        .sub(1);
      const eWithdrawnBaseTokens = (await lp.market.balances(1))
        .mul(lpPosition.liquidityBalance)
        .div(await lp.perpetual.getTotalLiquidityProvided())
        .sub(1);

      const proposedAmount = await getLiquidityProviderProposedAmountContract(
        lp,
        lpPositionAfterWithdraw,
        [eWithdrawnQuoteTokens, eWithdrawnBaseTokens],
        lpPosition.liquidityBalance
      );

      // Perpetual
      await expect(
        lp.perpetual.removeLiquiditySwap(
          lp.address,
          lpPosition.liquidityBalance,
          [eWithdrawnQuoteTokens, eWithdrawnBaseTokens],
          proposedAmount
        )
      ).to.be.reverted;
    });

    it('Should remove liquidity and swap, returning the baseProceeds in an error', async function () {
      // Provide liquidity
      await depositCollateralAndProvideLiquidity(
        lpTwo,
        lpTwo.ua,
        liquidityAmount
      );
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const globalPosition = await lp.perpetual.getGlobalPosition();
      const lpPosition = await lp.perpetual.getLpPosition(lp.address);
      const lpPositionAfterWithdraw = await getLpPositionAfterWithdrawal(
        lpPosition,
        globalPosition,
        lp.market
      );

      const eWithdrawnQuoteTokens = (await lp.market.balances(0))
        .mul(lpPosition.liquidityBalance)
        .div(await lp.perpetual.getTotalLiquidityProvided())
        .sub(1);
      const eWithdrawnBaseTokens = (await lp.market.balances(1))
        .mul(lpPosition.liquidityBalance)
        .div(await lp.perpetual.getTotalLiquidityProvided())
        .sub(1);

      const proposedAmount = await getLiquidityProviderProposedAmountContract(
        lp,
        lpPositionAfterWithdraw,
        [eWithdrawnQuoteTokens, eWithdrawnBaseTokens],
        lpPosition.liquidityBalance
      );

      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          lpPosition.liquidityBalance,
          [eWithdrawnQuoteTokens.add(1), eWithdrawnBaseTokens.add(1)],
          0,
          0
        )
      ).to.be.revertedWith('');

      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          lpPosition.liquidityBalance,
          [eWithdrawnQuoteTokens, eWithdrawnBaseTokens],
          proposedAmount,
          0
        )
      )
        .to.emit(lp.clearingHouse, 'LiquidityRemoved')
        .withArgs(0, lp.address, parseEther('1'));
    });

    // Unrealistic because pool/market should never be empty
    // it.skip('Should remove correct amount of liquidity from pool', async function () {
    //   // deposit
    //   await lp.clearingHouse.depositCollateralAndProvideLiquidity(
    //     0,
    //     liquidityAmount,
    //     lp.ua.address
    //   );
    //   const lpBalanceAfter = await lp.usdc.balanceOf(lp.address);
    //   expect(lpBalanceAfter).to.be.equal(0);

    //   // withdraw
    //   const positionBefore = await lp.perpetual.getLpPosition(lp.address);

    //   const dust = await TEST_dust_remove_liquidity(
    //     // dust balances remaining in contract
    //     lp.market,
    //     positionBefore.liquidityBalance,
    //     [MIN_MINT_AMOUNT, MIN_MINT_AMOUNT]
    //   );

    //   await expect(
    //     lp.clearingHouse.removeLiquidity(
    //       0,
    //       positionBefore.liquidityBalance,
    //       FULL_REDUCTION_RATIO,
    //       0,
    //       0,
    //       lp.usdc.address
    //     )
    //   )
    //     .to.emit(lp.clearingHouse, 'LiquidityRemoved')
    //     .withArgs(0, lp.address, positionBefore.liquidityBalance);

    //   const positionAfter = await lp.perpetual.getLpPosition(lp.address);

    //   expect(positionAfter.liquidityBalance).to.be.equal(0);
    //   expect(positionAfter.cumFundingRate).to.be.equal(0);
    //   expect(positionAfter.positionSize).to.be.equal(-dust.base);
    //   expect(positionAfter.openNotional).to.be.equal(-dust.quote);
    // });
  });

  describe('Use multiple collaterals', function () {
    it('Should properly account liquidity provided with UA and USDC', async function () {
      // set-up
      await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        liquidityAmount,
        [lp]
      );

      // first provide liquidity with UA
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);
      const lpPositionAfterFirstDeposit =
        await lp.clearingHouseViewer.getLpPosition(0, lp.address);

      // second provide liquidity with USDC
      await depositCollateralAndProvideLiquidity(
        lp,
        lp.usdc,
        liquidityAmount,
        0,
        1
      );
      const lpPositionAfterSecondDeposit =
        await lp.clearingHouseViewer.getLpPosition(0, lp.address);

      expect(lpPositionAfterSecondDeposit.liquidityBalance).to.gt(
        lpPositionAfterFirstDeposit.liquidityBalance
      );
    });

    it('LP should be able to withdraw one collateral without affecting his entire reserve position', async function () {
      // set-up
      await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        liquidityAmount,
        [lp]
      );

      // provide liquidity with 2 whitelisted collaterals
      await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);
      await depositCollateralAndProvideLiquidity(
        lp,
        lp.usdc,
        liquidityAmount,
        0,
        1
      );

      const lpPositionAfterBothDeposits =
        await lp.clearingHouseViewer.getLpPosition(0, lp.address);

      // remove half of the liquidity

      // increase time by lock period
      await increaseTimeAndMine(
        env,
        (await lp.perpetual.lockPeriod()).toNumber()
      );

      const proposedAmount = await getLiquidityProviderProposedAmount(
        lp,
        lpPositionAfterBothDeposits,
        lpPositionAfterBothDeposits.liquidityBalance.div(2),
        0
      );

      const eReductionRatio = ethers.utils.parseEther('0.5');
      await expect(
        lp.clearingHouse.removeLiquidity(
          0,
          lpPositionAfterBothDeposits.liquidityBalance.div(2),
          [0, 0],
          proposedAmount.add(1),
          0
        )
      )
        .to.emit(lp.clearingHouse, 'LiquidityRemoved')
        .withArgs(0, lp.address, eReductionRatio);

      const lpPositionAfterRemovingHalfLiquidity =
        await lp.clearingHouseViewer.getLpPosition(0, lp.address);
      expect(lpPositionAfterRemovingHalfLiquidity.liquidityBalance).to.eq(
        lpPositionAfterBothDeposits.liquidityBalance.div(2)
      );

      const lpReserveValueAfterRemovingHalfLiquidity =
        await lp.clearingHouseViewer.getReserveValue(lp.address, false);

      const lpUABalanceInProtocol = await lp.clearingHouseViewer.getBalance(
        lp.address,
        0
      );
      const lpUSDCBalanceInProtocol = await lp.clearingHouseViewer.getBalance(
        lp.address,
        1
      );
      // profit = initialUADeposit - uaAmountAfterRemoval
      const profit = lpUABalanceInProtocol
        .add(lpUSDCBalanceInProtocol)
        .sub(liquidityAmount);

      // because of the EVM maths, one USDC unit remains in the vault
      expect(lpReserveValueAfterRemovingHalfLiquidity).to.eq(
        liquidityAmount.add(profit)
      );
    });
  });
});
