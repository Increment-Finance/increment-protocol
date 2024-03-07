import {expect} from 'chai';
import {BigNumber} from 'ethers';
import {
  CURVE_TRADING_FEE_PRECISION,
  VBASE_INDEX,
  VQUOTE_INDEX,
  WAD,
} from '../../helpers/constants';
import {
  extendPositionWithCollateral,
  depositCollateralAndProvideLiquidity,
} from '../helpers/PerpetualUtilsFunctions';
import {ethers} from 'hardhat';
import {setup, createUABalance, User} from '../helpers/setup';
import {getCloseProposedAmount} from '../helpers/TradingGetters';
import {rMul} from '../helpers/utils/calculations';
import {Side} from '../helpers/utils/types';
import {
  TestStakingContract,
  TestStakingContract__factory,
} from '../../typechain';

describe('Increment App: ClearingHouseViewer', function () {
  let trader: User, lp: User, deployer: User;
  let depositAmount: BigNumber;

  beforeEach('Set up', async () => {
    ({lp, trader, deployer} = await setup());

    depositAmount = await createUABalance([lp, trader]);
    await depositCollateralAndProvideLiquidity(lp, lp.ua, depositAmount);
  });

  describe('Viewer Contract', function () {
    it('Can call getProposedAmount for long position', async function () {
      // should have enough balance to deposit
      await extendPositionWithCollateral(
        trader,
        trader.ua,
        depositAmount.div(100),
        depositAmount.div(100),
        Side.Long
      );

      const proposedAmount = await trader.clearingHouseViewer.getProposedAmount(
        0,
        trader.address,
        true,
        WAD,
        100
      );

      expect(proposedAmount.amountIn).to.be.closeTo(
        await getCloseProposedAmount(
          await trader.clearingHouseViewer.getTraderPosition(0, trader.address),
          trader.market,
          trader.curveViews
        ),
        2
      );
    });
    it('Can call getProposedAmount for short position', async function () {
      // should have enough balance to deposit
      await extendPositionWithCollateral(
        trader,
        trader.ua,
        depositAmount.div(100),
        depositAmount.div(100),
        Side.Short
      );

      const proposedAmount = await trader.clearingHouseViewer.getProposedAmount(
        0,
        trader.address,
        true,
        WAD,
        400
      );

      expect(proposedAmount.amountIn).to.be.closeTo(
        await getCloseProposedAmount(
          await trader.clearingHouseViewer.getTraderPosition(0, trader.address),
          trader.market,
          trader.curveViews
        ),
        2
      );
    });

    it('Can precisely predict proposedAmount', async function () {
      // init
      await extendPositionWithCollateral(
        trader,
        trader.ua,
        depositAmount.div(100),
        depositAmount.div(100),
        Side.Short
      );

      // get proposed amount (feat adjustment)
      const traderPosition = await trader.perpetual.getTraderPosition(
        trader.address
      );
      const proposedAmount = await getCloseProposedAmount(
        traderPosition,
        trader.market,
        trader.curveViews
      );

      // get expected amount (adjusted)
      const realizedVBaseTokens = await trader.curveViews.get_dy_ex_fees(
        trader.market.address,
        VQUOTE_INDEX,
        VBASE_INDEX,
        proposedAmount
      );

      expect(realizedVBaseTokens.add(traderPosition.positionSize)).to.be.eq(0);
    });
  });

  describe('Helper functions', async function () {
    describe('Trader functions', async function () {
      it('Can calculate the unrealized profit and loss of not a Trader', async function () {
        await expect(
          trader.clearingHouseViewer.getTraderUnrealizedPnL(0, trader.address)
        ).to.not.be.reverted;
      });

      it('Can calculate the unrealized profit and loss of a Trader', async function () {
        // should have enough balance to deposit
        await extendPositionWithCollateral(
          trader,
          trader.ua,
          depositAmount.div(100),
          depositAmount.div(100),
          Side.Short
        );

        const traderPosition = await trader.perpetual.getTraderPosition(
          trader.address
        );
        const quoteProceeds = rMul(
          await trader.perpetual.indexPrice(),
          traderPosition.positionSize
        );
        const tradingFees = quoteProceeds
          .abs()
          .mul(await trader.market.out_fee())
          .div(CURVE_TRADING_FEE_PRECISION); // @dev: take upper bound on the trading fees

        const ePnl = traderPosition.openNotional
          .add(quoteProceeds)
          .sub(tradingFees);
        expect(
          await trader.clearingHouseViewer.getTraderUnrealizedPnL(
            0,
            trader.address
          )
        ).to.be.eq(ePnl);
      });

      it('Can calculate the funding payments of not a Trader', async function () {
        await expect(
          trader.clearingHouseViewer.getTraderUnrealizedPnL(0, trader.address)
        ).to.not.be.reverted;
      });
    });
    describe('Liquidity Provider functions', async function () {
      it('Can calculate the unrealized profit and loss of not a Liquidity Provider', async function () {
        await expect(
          trader.clearingHouseViewer.getLpUnrealizedPnL(0, trader.address)
        ).to.not.be.reverted;
      });
      it('Can calculate the unrealized profit and loss of a Liquidity Provider', async function () {
        // should have enough balance to deposit
        await depositCollateralAndProvideLiquidity(
          trader,
          trader.ua,
          depositAmount
        );

        const lpPositionAfterWithdrawal =
          await trader.perpetual.getLpPositionAfterWithdrawal(trader.address);

        const quoteProceeds = rMul(
          await trader.perpetual.indexPrice(),
          lpPositionAfterWithdrawal.positionSize
        );
        const tradingFees = quoteProceeds
          .abs()
          .mul(await trader.market.out_fee())
          .div(CURVE_TRADING_FEE_PRECISION); // @dev: take upper bound on the trading fees

        const ePnl = lpPositionAfterWithdrawal.openNotional
          .add(quoteProceeds)
          .sub(tradingFees);

        expect(
          await trader.perpetual.getLpUnrealizedPnL(trader.address)
        ).to.be.eq(ePnl);
      });
    });
    it('Can calculate the funding payments not of a Liquidity Provider', async function () {
      await expect(
        trader.clearingHouseViewer.getLpFundingPayments(0, trader.address)
      ).to.not.be.reverted;
    });
  });
  describe('Staking Contract', async function () {
    let stakingContract: TestStakingContract;

    beforeEach('Set up', async () => {
      const [deployerA] = await ethers.getSigners();
      const StakingContract = <TestStakingContract__factory>(
        await ethers.getContractFactory('TestStakingContract', deployerA)
      );
      stakingContract = await StakingContract.deploy(
        trader.clearingHouse.address,
        trader.usdc.address
      );
    });

    it('Can add the staking contract', async function () {
      await expect(
        deployer.clearingHouse.addStakingContract(stakingContract.address)
      )
        .to.emit(deployer.clearingHouse, 'StakingContractChanged')
        .withArgs(stakingContract.address);

      expect(await stakingContract.isGovernor(deployer.address)).to.be.true;
    });
    it('Can store liquidity position in staking contract', async function () {
      await deployer.clearingHouse.addStakingContract(stakingContract.address);

      // deposit liquidity
      await depositCollateralAndProvideLiquidity(
        trader,
        trader.ua,
        depositAmount
      );
      expect(await stakingContract.balanceOf(trader.address)).to.be.eq(
        depositAmount
      );
    });
  });
});
