import {expect} from 'chai';
import {BigNumber} from 'ethers';

import {createUABalance, setup, User} from '../helpers/setup';
import {
  depositIntoVault,
  depositCollateralAndProvideLiquidity,
  sendUAToInsurance,
} from '../helpers/PerpetualUtilsFunctions';
import {Side} from '../helpers/utils/types';
import {rMul} from '../helpers/utils/calculations';
import {InsuranceErrors} from '../../helpers/errors';
import {ethers} from 'hardhat';
describe('Increment App: Insurance', function () {
  let user: User;
  let lp: User;
  let trader: User;
  let deployer: User;
  let insuranceFee: BigNumber;

  let depositAmount: BigNumber;

  beforeEach('Set up', async () => {
    ({user, lp, trader, deployer} = await setup());

    insuranceFee = await user.perpetual.insuranceFee();

    depositAmount = await createUABalance([user, lp, trader]);
  });

  it('Insurance should settle debt when it has enough funds', async function () {
    await sendUAToInsurance(lp, depositAmount);

    // generate bad user debt
    await deployer.vault.__TestVault_change_trader_balance(
      user.address,
      0,
      depositAmount.mul(-1)
    );
    await expect(deployer.clearingHouse.seizeCollateral(user.address))
      .to.emit(user.vault, 'TraderBadDebtGenerated')
      .withArgs(user.address, depositAmount);

    expect(await user.insurance.systemBadDebt()).to.be.eq(0);
  });

  it('Insurance should generate bad system debt when enough available', async function () {
    // generate bad user debt
    await deployer.vault.__TestVault_change_trader_balance(
      user.address,
      0,
      depositAmount.mul(-1)
    );
    await expect(deployer.clearingHouse.seizeCollateral(user.address))
      .to.emit(user.vault, 'TraderBadDebtGenerated')
      .withArgs(user.address, depositAmount)
      .to.emit(user.insurance, 'SystemDebtChanged')
      .withArgs(depositAmount);

    expect(await user.insurance.systemBadDebt()).to.be.eq(depositAmount);
  });

  it('Insurance bad debt should be returned to the Vault and cancelled out in the Insurance accounting', async function () {
    // generate bad user debt
    await deployer.vault.__TestVault_change_trader_balance(
      user.address,
      0,
      ethers.utils.parseEther('0.15').mul(-1)
    );

    await deployer.clearingHouse.seizeCollateral(user.address);

    const initialSystemBadDebtBeforeTrade =
      await user.insurance.systemBadDebt();

    // 1. Pay back the some of the Insurance debt but not all of it
    await depositCollateralAndProvideLiquidity(lp, lp.ua, depositAmount);
    await depositIntoVault(trader, trader.ua, depositAmount);

    const tradeAmount = depositAmount.div(100);
    const eInsuranceFeeAmount = rMul(
      tradeAmount,
      await trader.clearingHouseViewer.insuranceFee(0)
    );
    const eSystemBadDebtAfterFirstTrade =
      initialSystemBadDebtBeforeTrade.sub(eInsuranceFeeAmount);
    const vaultBalanceBeforeFirstTrade = await user.ua.balanceOf(
      user.vault.address
    );

    await expect(
      trader.clearingHouse.changePosition(0, tradeAmount, 0, Side.Long)
    )
      .to.emit(trader.insurance, 'SystemDebtChanged')
      .withArgs(eSystemBadDebtAfterFirstTrade);

    const systemBadDebtAfterFirstTrade = await user.insurance.systemBadDebt();
    expect(systemBadDebtAfterFirstTrade).to.eq(eSystemBadDebtAfterFirstTrade);
    const vaultBalanceBeforeSecondTrade = await user.ua.balanceOf(
      user.vault.address
    );
    expect(vaultBalanceBeforeSecondTrade).to.eq(vaultBalanceBeforeFirstTrade);

    // 2. Pay back all the Insurance debt
    const vaultInternalUAAccountingBeforeSecondTrade = (
      await user.vault.getWhiteListedCollateral(0)
    ).currentAmount;
    const eSystemBadDebtAfterSecondTrade = 0;
    await expect(
      trader.clearingHouse.changePosition(0, tradeAmount, 0, Side.Long)
    )
      .to.emit(trader.insurance, 'SystemDebtChanged')
      .withArgs(eSystemBadDebtAfterSecondTrade);

    const systemBadDebtAfterSecondTrade = await user.insurance.systemBadDebt();
    expect(systemBadDebtAfterSecondTrade).to.eq(eSystemBadDebtAfterSecondTrade);

    const vaultBalanceAfterSecondTrade = await user.ua.balanceOf(
      user.vault.address
    );
    expect(vaultBalanceAfterSecondTrade).to.eq(
      vaultBalanceBeforeSecondTrade.sub(eInsuranceFeeAmount.div(2))
    );

    const vaultInternalUAAccountingAfterSecondTrade = (
      await user.vault.getWhiteListedCollateral(0)
    ).currentAmount;
    expect(vaultInternalUAAccountingAfterSecondTrade).to.eq(
      vaultInternalUAAccountingBeforeSecondTrade.sub(eInsuranceFeeAmount.div(2))
    );

    const insuranceBalanceAfterSecondTrade = await user.ua.balanceOf(
      user.insurance.address
    );
    expect(insuranceBalanceAfterSecondTrade).to.eq(eInsuranceFeeAmount.div(2));
  });

  it('Trader should pay insurance fee when opening a position', async function () {
    // set-up
    await depositCollateralAndProvideLiquidity(lp, lp.ua, depositAmount);

    // deposit tokens
    const tradeAmount = depositAmount.div(100); // 1% of lp is traded

    await depositIntoVault(trader, trader.ua, tradeAmount);

    const traderReserveDeposited = await trader.vault.getReserveValue(
      trader.address,
      false
    );

    // open position
    const percentageFee = await trader.curveViews.get_dy_fees_perc(
      trader.market.address,
      0,
      1,
      tradeAmount
    );
    await trader.clearingHouse.changePosition(0, tradeAmount, 0, Side.Long);

    const traderPosition = await trader.perpetual.getTraderPosition(
      trader.address
    );

    const insurancePayed = rMul(
      traderPosition.openNotional.abs(),
      insuranceFee
    );

    const tradingFeesPayed = rMul(
      traderPosition.openNotional.abs(),
      percentageFee
    );

    expect(await trader.vault.getReserveValue(trader.address, false)).to.be.eq(
      traderReserveDeposited.sub(insurancePayed).sub(tradingFeesPayed)
    );

    expect(await trader.ua.balanceOf(user.insurance.address)).to.be.eq(
      insurancePayed
    );
  });

  it('Owner cannot withdraw insurance if there is system bad debt', async function () {
    await deployer.insurance.__TestInsurance_setSystemBadDebt(
      ethers.utils.parseEther('1')
    );

    await expect(deployer.insurance.removeInsurance(1)).to.be.revertedWith(
      InsuranceErrors.InsufficientInsurance
    );
  });

  it('Owner can withdraw insurance fees exceeding 10% of TVL', async function () {
    // provide initial liquidity
    const liquidityAmount = await createUABalance([deployer, lp, user]);
    await depositCollateralAndProvideLiquidity(lp, lp.ua, liquidityAmount);

    // insurance owns > 10% of TVL
    const tvl = await user.vault.getTotalValueLocked();
    const insuranceEarned = tvl.div(9);

    // everything exceeding 10% of TVL can be withdrawn
    const maxWithdrawal = insuranceEarned.sub(
      rMul(tvl, await user.clearingHouse.insuranceRatio())
    );

    await deployer.ua.transfer(user.insurance.address, insuranceEarned);
    expect(await deployer.ua.balanceOf(user.insurance.address)).to.eq(
      insuranceEarned
    );

    // can withdraw (insuranceFees - 10% of TVL)
    await expect(
      deployer.insurance.removeInsurance(maxWithdrawal.add(1))
    ).to.be.revertedWith(InsuranceErrors.InsufficientInsurance);

    await expect(deployer.insurance.removeInsurance(maxWithdrawal))
      .to.emit(user.insurance, 'InsuranceRemoved')
      .withArgs(maxWithdrawal);
  });
});
