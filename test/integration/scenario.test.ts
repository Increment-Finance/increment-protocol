import {expect} from 'chai';
import env, {ethers} from 'hardhat';
import {BigNumber} from 'ethers';

import {setup, createUABalance, User} from '../helpers/setup';
import {Side} from '../helpers/utils/types';
import {
  extendPositionWithCollateral,
  closePosition,
  depositCollateralAndProvideLiquidity,
  removeLiquidity,
} from '../helpers/PerpetualUtilsFunctions';
import {changeChainlinkOraclePrice} from '../helpers/ChainlinkUtils';
import {deployJPYUSDMarket} from '../helpers/deployNewMarkets';
import {increaseTimeAndMine} from '../../helpers/misc-utils';

// https://docs.chain.link/docs/ethereum-addresses/
const parsePrice = (num: string) => ethers.utils.parseUnits(num, 8);

const EURUSDMarketIdx = 0;
const JPYUSDMarketIdx = 1;

describe('Increment App: Scenario', function () {
  let deployer: User, trader: User, lp: User;

  let liquidityAmount: BigNumber;
  let tradeAmount: BigNumber;

  beforeEach('Set up', async () => {
    ({deployer, lp, trader} = await setup());

    liquidityAmount = await createUABalance([deployer, lp, trader]);
    tradeAmount = liquidityAmount.div(20); // trade 5% of liquidity

    /* important: provide some initial liquidity to the market -> w/o any liquidity left, the market will stop working */
    await depositCollateralAndProvideLiquidity(
      deployer,
      deployer.ua,
      liquidityAmount
    );
  });

  async function checks() {
    // start: balanceOf(trader) + balanceOf(liquidityProvider) <= end: balanceOf(trader) + balanceOf(liquidityProvider)
    const lpBalanceAfter = await lp.ua.balanceOf(lp.address);
    const traderBalanceAfter = await trader.ua.balanceOf(trader.address);

    if (lpBalanceAfter.add(traderBalanceAfter).gt(liquidityAmount.mul(2))) {
      console.log('fails');
    }

    expect(lpBalanceAfter.add(traderBalanceAfter)).to.be.lte(
      liquidityAmount.mul(2)
    );
  }

  describe('One LP & one Trader (in one market)', async function () {
    describe('1. Should remain solvent with no oracle price change', async function () {
      it('1.1. LP provides liquidity, trader opens long position and closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('1.2. LP provides liquidity, trader opens long position and closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
    });
    describe('2. EUR/USD increases & long trade', async function () {
      it('2.1. EUR/USD increases, LP provides liquidity, trader opens long position, trader closes position, LP withdraws liquidity', async function () {
        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('2.2. LP provides liquidity, EUR/USD increases, trader opens long position, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('2.3. LP provides liquidity, trader opens long position, EUR/USD increases, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });

      it('2.4. LP provides liquidity, trader opens long position, trader closes position, EUR/USD increases, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
    });
    describe('3. EUR/USD increases & short trade', async function () {
      it('3.1. EUR/USD increases, LP provides liquidity, trader opens short position, trader closes position, LP withdraws liquidity', async function () {
        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('3.2. LP provides liquidity, EUR/USD increases, trader opens short position, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('3.3. LP provides liquidity, trader opens short position, EUR/USD increases, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });

      it('3.4. LP provides liquidity, trader opens short position, trader closes position, EUR/USD increases, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        await closePosition(trader, trader.ua);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1.2'));

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
    });
    describe('4. EUR/USD decreases & long trade', async function () {
      it('4.1. EUR/USD decreases, LP provides liquidity, trader opens long position, trader closes position, LP withdraws liquidity', async function () {
        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('4.2. LP provides liquidity, EUR/USD decreases, trader opens long position, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('4.3. LP provides liquidity, trader opens long position, EUR/USD decreases, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });

      it('4.4. LP provides liquidity, trader opens long position, trader closes position, EUR/USD decreases, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Long
        );

        await closePosition(trader, trader.ua);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
    });
    describe('5. EUR/USD decreases & short trade', async function () {
      it('5.1. EUR/USD decreases, LP provides liquidity, trader opens short position, trader closes position, LP withdraws liquidity', async function () {
        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('5.2. LP provides liquidity, EUR/USD decreases, trader opens short position, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
      it('5.3. LP provides liquidity, trader opens short position, EUR/USD decreases, trader closes position, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await closePosition(trader, trader.ua);

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);
        // // check results
        // await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });

      it('5.4. LP provides liquidity, trader opens short position, trader closes position, EUR/USD decreases, LP withdraws liquidity', async function () {
        await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

        await extendPositionWithCollateral(
          trader,
          trader.ua,
          tradeAmount,
          tradeAmount,
          Side.Short
        );

        await closePosition(trader, trader.ua);

        // change price
        await changeChainlinkOraclePrice(parsePrice('1'));

        await increaseTimeAndMine(
          env,
          (await lp.perpetual.lockPeriod()).toNumber()
        );
        await removeLiquidity(lp);

        // check results
        await checks();
        // await logUserBalance(lp, 'lp');
        // await logUserBalance(trader, 'trader');
        // await logVaultBalance(lp);
      });
    });
  });

  describe('LPs & Traders (in multiple markets)', async function () {
    it('Adding a new market (trading pair) succeeds', async function () {
      // EUR_USD (from deploy)
      expect(await deployer.clearingHouse.getNumMarkets()).to.eq(1);

      await deployJPYUSDMarket();

      // EUR_USD + JPY_USD
      expect(await deployer.clearingHouse.getNumMarkets()).to.eq(2);
    });

    it('Extending position on any market increases the insurance fee in the same way', async function () {
      // set-up
      await deployJPYUSDMarket();
      await depositCollateralAndProvideLiquidity(
        lp,
        lp.ua,
        liquidityAmount,
        JPYUSDMarketIdx
      );

      // initial insurance fee
      expect(
        await trader.vault.getReserveValue(
          deployer.clearingHouse.address,
          false
        )
      ).to.eq(0);

      // 1. Trader opens position in JYP_USD market with collateral
      await extendPositionWithCollateral(
        trader,
        trader.ua,
        tradeAmount.div(2),
        tradeAmount.div(2),
        Side.Long,
        JPYUSDMarketIdx
      );

      // insurance fee after trade of tradeAmount volume in JYP_USD
      const insuranceFeeAfterJPYUSDTrade = await trader.vault.getReserveValue(
        deployer.clearingHouse.address,
        false
      );

      await extendPositionWithCollateral(
        trader,
        trader.ua,
        tradeAmount.div(2),
        tradeAmount.div(2),
        Side.Long,
        EURUSDMarketIdx
      );

      const insuranceFeeAfterEURUSDTrade = await trader.vault.getReserveValue(
        deployer.clearingHouse.address,
        false
      );

      expect(insuranceFeeAfterEURUSDTrade).to.eq(
        insuranceFeeAfterJPYUSDTrade.mul(2)
      );
    });
  });
});
