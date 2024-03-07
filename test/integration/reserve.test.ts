import {expect} from 'chai';
import {utils, BigNumber} from 'ethers';
import env, {ethers} from 'hardhat';

import {createUABalance, setup, User} from '../helpers/setup';
import {
  convertToCurrencyDecimals,
  convertToCurrencyUnits,
  tokenToWad,
} from '../../helpers/contracts-helpers';
import {AccessControlErrors, VaultErrors} from '../../helpers/errors';
import {
  addUSDCCollateralAndUSDCBalanceToUsers,
  whiteListAsset,
  addTokenToUser,
} from '../helpers/PerpetualUtilsFunctions';
import {depositIntoVault} from '../helpers/PerpetualUtilsFunctions';
import {wadToToken} from '../../helpers/contracts-helpers';
import {getChainlinkOracle} from '../../helpers/contracts-getters';
import {parseEther} from 'ethers/lib/utils';
import {asBigNumber, rMul, rDiv} from '../helpers/utils/calculations';
import {depositCollateralAndProvideLiquidity} from '../helpers/PerpetualUtilsFunctions';
import {setUSDCBalance} from '../helpers/utils/manipulateStorage';
import {WAD} from '../../helpers/constants';
import {hours} from '../../helpers/time';

const FOREX_HEARTBEAT = hours(25);

describe('Increment App: Reserve', function () {
  let user: User, deployer: User;
  let depositAmount: BigNumber;

  beforeEach('Set up', async () => {
    ({deployer, user} = await setup());

    depositAmount = await createUABalance([deployer, user]);
    await user.ua.approve(user.vault.address, depositAmount);
  });

  describe('Can deposit and withdraw', function () {
    it('Should have enough cash and allowances', async function () {
      // should have enough balance to deposit
      expect(depositAmount).to.be.above(0);
      expect(await user.ua.balanceOf(user.address)).to.be.equal(depositAmount);
      // should successfully approve
      expect(
        await user.ua.allowance(user.address, user.vault.address)
      ).to.be.equal(depositAmount);
    });

    it('Should not be able to deposit unsupported collateral', async function () {
      await expect(
        user.clearingHouse.deposit(depositAmount, user.usdc.address)
      ).to.be.revertedWith(VaultErrors.UnsupportedCollateral);
    });

    it('Should not be able to transfer UA when not ClearingHouse or Insurance', async function () {
      await expect(
        user.vault.transferUa(user.usdc.address, depositAmount)
      ).to.be.revertedWith(VaultErrors.SenderNotClearingHouseNorInsurance);
    });

    it('Should revert if user tries to deposit more than the max amount allowed for this collateral', async function () {
      await deployer.vault.changeCollateralMaxAmount(
        deployer.ua.address,
        utils.parseEther('100')
      );

      const amountAboveMaxCollateralAmount = depositAmount;
      await expect(
        user.clearingHouse.deposit(
          amountAboveMaxCollateralAmount,
          user.ua.address
        )
      ).to.be.revertedWith(VaultErrors.MaxCollateralAmountExceeded);
    });

    it('Can deposit UA into the vault, getReserveValue reflects the amount correctly', async function () {
      // depositing should fire up deposit event
      await expect(user.clearingHouse.deposit(depositAmount, user.ua.address))
        .to.emit(user.vault, 'Deposit')
        .withArgs(user.address, user.ua.address, depositAmount);

      // should have correct balance in vault
      expect(await user.ua.balanceOf(user.address)).to.be.equal(0);
      expect(await user.ua.balanceOf(user.vault.address)).to.be.equal(
        depositAmount
      );

      // should notice deposited amount in asset value / portfolio value
      expect(
        utils.formatEther(await user.vault.getReserveValue(user.address, false))
      ).to.be.equal(await convertToCurrencyUnits(user.ua, depositAmount));

      // collateral current amount should be updated
      const uaCollateral = await user.vault.getWhiteListedCollateral(0);
      expect(uaCollateral.currentAmount).to.eq(depositAmount);
    });

    it('Can deposit UA into the vault, free collateral returns proper result', async function () {
      const minMarginAtCreation =
        await deployer.clearingHouse.minMarginAtCreation();

      expect(
        await user.clearingHouse.getFreeCollateralByRatio(
          user.address,
          minMarginAtCreation
        )
      ).to.eq(0);

      await expect(
        user.clearingHouse.deposit(depositAmount.div(2), user.ua.address)
      )
        .to.emit(user.vault, 'Deposit')
        .withArgs(user.address, user.ua.address, depositAmount.div(2));

      expect(await user.vault.getBalance(user.address, 0)).to.eq(
        depositAmount.div(2)
      );
      const freeCollateralAfterFirstDeposit =
        await user.clearingHouse.getFreeCollateralByRatio(
          user.address,
          minMarginAtCreation
        );
      expect(freeCollateralAfterFirstDeposit).to.eq(depositAmount.div(2));

      await depositCollateralAndProvideLiquidity(
        user,
        user.ua,
        depositAmount.div(2),
        0
      );

      const collateral = await user.vault.getBalance(user.address, 0);
      const marginRequired = await user.clearingHouse.getTotalMarginRequirement(
        user.address,
        minMarginAtCreation
      );
      const pnl = await user.clearingHouse.getPnLAcrossMarkets(user.address);

      const freeCollateralAfterProvidingLiquidity =
        await user.clearingHouse.getFreeCollateralByRatio(
          user.address,
          minMarginAtCreation
        );

      expect(collateral).to.eq(depositAmount);
      expect(freeCollateralAfterProvidingLiquidity).to.eq(
        collateral.add(pnl).sub(marginRequired)
      );
    });

    it('Free collateral diminishes after providing liquidity', async function () {
      const minMarginAtCreation =
        await deployer.clearingHouse.minMarginAtCreation();

      await user.clearingHouse.deposit(depositAmount, user.ua.address);

      const freeCollateralAfterDeposit =
        await user.clearingHouse.getFreeCollateralByRatio(
          user.address,
          minMarginAtCreation
        );
      expect(await user.vault.getBalance(user.address, 0)).to.eq(
        freeCollateralAfterDeposit
      );

      await user.clearingHouse.provideLiquidity(
        0,
        [depositAmount, rDiv(depositAmount, await user.perpetual.indexPrice())],
        0
      );

      const collateral = await user.vault.getBalance(user.address, 0);
      const unrealizedPositionPnl =
        await user.clearingHouse.getPnLAcrossMarkets(user.address);
      const absOpenNotional = await user.clearingHouse.getDebtAcrossMarkets(
        user.address
      );

      const eFreeCollateral = collateral
        .add(unrealizedPositionPnl)
        .sub(absOpenNotional);

      const freeCollateralAfterProvidingLiquidity =
        await user.clearingHouse.getFreeCollateralByRatio(
          user.address,
          minMarginAtCreation
        );

      expect(freeCollateralAfterProvidingLiquidity).to.be.lt(
        freeCollateralAfterDeposit
      );
      expect(eFreeCollateral).to.be.lt(freeCollateralAfterDeposit);
    });

    it('Deposit function should harmonize collateral decimals', async function () {
      const oneWadToken = ethers.utils.parseEther('1');

      // set-up
      const oneTokenUSDCDecimal = await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        oneWadToken,
        [user]
      );

      await user.clearingHouse.deposit(oneWadToken, user.ua.address);

      // deposit amount in USDC
      await user.clearingHouse.deposit(oneTokenUSDCDecimal, user.usdc.address);

      const uaDepositHarmonizedAmount = await user.vault.getBalance(
        user.address,
        0
      );
      const usdcDepositHarmonizedAmount = await user.vault.getBalance(
        user.address,
        1
      );

      expect(uaDepositHarmonizedAmount).to.eq(oneWadToken);
      expect(usdcDepositHarmonizedAmount).to.eq(oneWadToken);
    });

    it('Collateral USD value should be adjusted by weight', async function () {
      const newTokenWeight = ethers.utils.parseEther('0.5');

      const newToken = await whiteListAsset(deployer, env, newTokenWeight);
      const userT = await addTokenToUser(user, newToken, 'newToken');

      // deposit newToken
      await userT.newToken.mint(depositAmount);
      await userT.newToken.approve(user.vault.address, depositAmount);

      await userT.clearingHouse.deposit(depositAmount, newToken.address);

      const collateralDiscountedUSDValue = await user.vault.getReserveValue(
        user.address,
        true
      );

      expect(collateralDiscountedUSDValue).to.eq(
        rMul(depositAmount, newTokenWeight)
      );
    });

    it('User reserve value should be adjusted by the weights of the collaterals', async function () {
      const newTokenWeight = ethers.utils.parseEther('0.5');
      const newToken = await whiteListAsset(deployer, env, newTokenWeight);
      const userT = await addTokenToUser(user, newToken, 'newToken');

      // deposit newToken
      await userT.newToken.mint(depositAmount);
      await userT.newToken.approve(user.vault.address, depositAmount);
      await userT.clearingHouse.deposit(depositAmount, newToken.address);

      const undiscountedReserveValue =
        await userT.vault.__TestVault_getUserReserveValue(userT.address, false);
      const discountedReserveValue =
        await userT.vault.__TestVault_getUserReserveValue(userT.address, true);

      expect(undiscountedReserveValue).to.eq(depositAmount);
      expect(discountedReserveValue).to.eq(rMul(depositAmount, newTokenWeight));

      // deposit UA
      await userT.clearingHouse.deposit(depositAmount, user.ua.address);

      const undiscountedReserveValueAfter2ndDeposit =
        await userT.vault.__TestVault_getUserReserveValue(userT.address, false);
      const discountedReserveValueAfter2ndDeposit =
        await userT.vault.__TestVault_getUserReserveValue(userT.address, true);

      expect(undiscountedReserveValueAfter2ndDeposit).to.eq(
        depositAmount.mul(2)
      );
      const eDiscountedReserveValueAfter2ndDeposit = depositAmount.add(
        rMul(depositAmount, newTokenWeight)
      );
      expect(discountedReserveValueAfter2ndDeposit).to.eq(
        eDiscountedReserveValueAfter2ndDeposit
      );
    });

    it('Should be able to deposit funds to whiteListed collaterals different than UA', async function () {
      // set-up
      const usdcDepositAmount = await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount,
        [user]
      );

      // depositing should fire up deposit event
      await expect(
        user.clearingHouse.deposit(usdcDepositAmount, user.usdc.address)
      )
        .to.emit(user.vault, 'Deposit')
        .withArgs(user.address, user.usdc.address, usdcDepositAmount);

      // should have correct balance in vault
      expect(await user.usdc.balanceOf(user.address)).to.be.equal(0);
      expect(await user.usdc.balanceOf(user.vault.address)).to.be.equal(
        usdcDepositAmount
      );

      expect(
        utils.formatEther(await user.vault.getReserveValue(user.address, false))
      ).to.be.equal(await convertToCurrencyUnits(user.usdc, usdcDepositAmount));

      // collateral current amount should be updated
      const usdcCollateral = await user.vault.getWhiteListedCollateral(1);
      expect(usdcCollateral.currentAmount).to.eq(
        await tokenToWad(await user.usdc.decimals(), usdcDepositAmount)
      );
    });

    it('Should be able to deposit and withdraw funds to whiteListed collaterals with unusually large decimals', async function () {
      // create a big token
      await env.deployments.deploy('USDCmock', {
        from: deployer.address,
        args: ['BIG', 'BIG Decimals Token', 24],
      });
      const bigToken = await ethers.getContract('USDCmock', deployer.address);

      // whitelist token in Vault
      await deployer.vault.addWhiteListedCollateral(
        bigToken.address,
        utils.parseEther('1'),
        ethers.constants.MaxUint256
      );

      // add oracle
      const bigOracle = getChainlinkOracle(env, 'USDC');
      await deployer.oracle.setOracle(
        bigToken.address,
        bigOracle,
        FOREX_HEARTBEAT,
        false
      );
      await deployer.oracle.setFixedPrice(
        bigToken.address,
        utils.parseEther('1')
      );

      const bigBalance = await wadToToken(
        await bigToken.decimals(),
        parseEther('1000')
      );
      await bigToken.mint(deployer.address, bigBalance);
      await bigToken.approve(deployer.vault.address, bigBalance);

      // depositing should fire up deposit event
      await expect(deployer.clearingHouse.deposit(bigBalance, bigToken.address))
        .to.emit(deployer.vault, 'Deposit')
        .withArgs(deployer.address, bigToken.address, bigBalance);

      // should have correct balance in vault
      expect(await bigToken.balanceOf(deployer.address)).to.be.equal(0);
      expect(await bigToken.balanceOf(deployer.vault.address)).to.be.equal(
        bigBalance
      );

      expect(
        await deployer.vault.getReserveValue(deployer.address, false)
      ).to.be.equal(await tokenToWad(24, bigBalance));

      // collateral current amount should be updated
      const bigTokenCollateral = await deployer.vault.getWhiteListedCollateral(
        1
      );
      expect(bigTokenCollateral.currentAmount).to.eq(
        await tokenToWad(24, bigBalance)
      );

      await expect(
        deployer.clearingHouse.withdraw(bigBalance, bigToken.address)
      )
        .to.emit(deployer.vault, 'Withdraw')
        .withArgs(deployer.address, bigToken.address, bigBalance);

      expect(await bigToken.balanceOf(deployer.address)).to.be.equal(
        bigBalance
      );

      expect(await bigToken.balanceOf(deployer.vault.address)).to.be.equal(0);
    });

    it('Reserve value should account for amount deposited in all whiteListed collaterals', async function () {
      // set-up
      const usdcDepositAmount = await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount,
        [user]
      );

      // deposit amount in UA
      await user.clearingHouse.deposit(depositAmount, user.ua.address);

      // deposit amount in USDC
      await user.clearingHouse.deposit(usdcDepositAmount, user.usdc.address);

      expect(await user.vault.getReserveValue(user.address, false)).to.eq(
        // depositAmount in UA + usdcDepositAmount in USDC
        depositAmount.mul(2)
      );
    });

    it('Should not be able to withdraw unsupported collateral', async function () {
      await user.clearingHouse.deposit(depositAmount, user.ua.address);

      await expect(
        user.clearingHouse.withdraw(depositAmount, user.usdc.address)
      ).to.be.revertedWith(VaultErrors.UnsupportedCollateral);
    });

    it('Should not be able to withdraw collateral with a UA debt', async function () {
      // set-up
      const usdcDepositAmount = await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount,
        [user]
      );

      await user.clearingHouse.deposit(usdcDepositAmount, user.usdc.address);

      const UA_IDX = 0;
      await user.vault.__TestVault_change_trader_balance(
        user.address,
        UA_IDX,
        utils.parseEther('100').mul(-1)
      );

      await expect(
        user.clearingHouse.withdraw(usdcDepositAmount, user.usdc.address)
      ).to.be.revertedWith(VaultErrors.UADebt);
    });

    it('Should be able to withdraw whiteListed collateral', async function () {
      // set-up
      const usdcDepositAmount = await addUSDCCollateralAndUSDCBalanceToUsers(
        deployer,
        env,
        depositAmount,
        [user]
      );

      await user.clearingHouse.deposit(usdcDepositAmount, user.usdc.address);

      await user.clearingHouse.withdraw(usdcDepositAmount, user.usdc.address);
    });

    it('Should withdraw UA', async function () {
      // deposit
      await user.clearingHouse.deposit(depositAmount, user.ua.address);
      const userDeposits = await user.vault.getReserveValue(
        user.address,
        false
      );

      // withdrawal should fire up withdrawal event
      await expect(user.clearingHouse.withdraw(userDeposits, user.ua.address))
        .to.emit(user.vault, 'Withdraw')
        .withArgs(user.address, user.ua.address, userDeposits);

      // balance should be same as before withdrawal
      expect(await user.ua.balanceOf(user.address)).to.be.equal(depositAmount);
      expect(await user.vault.getReserveValue(user.address, false)).to.be.equal(
        0
      );
    });

    it('Should withdraw all UA', async function () {
      // deposit
      await user.clearingHouse.deposit(depositAmount, user.ua.address);

      // withdrawal should fire up withdrawal event
      await expect(user.clearingHouse.withdrawAll(user.ua.address))
        .to.emit(user.vault, 'Withdraw')
        .withArgs(user.address, user.ua.address, depositAmount);
    });

    it('Should not withdraw more UA than deposited', async function () {
      // deposit
      await user.clearingHouse.deposit(depositAmount, user.ua.address);
      const userDeposits = await user.vault.getReserveValue(
        user.address,
        false
      );
      const tooLargeWithdrawal = userDeposits.add(1);

      // should not be able to withdraw more than deposited
      await expect(
        user.clearingHouse.withdraw(tooLargeWithdrawal, user.ua.address)
      ).to.be.revertedWith(VaultErrors.WithdrawExcessiveAmount);
    });

    it('Should not withdraw other token than deposited', async function () {
      // deposit
      await user.clearingHouse.deposit(depositAmount, user.ua.address);
      const userDeposits = await user.vault.getReserveValue(
        user.address,
        false
      );

      // should not be able to withdraw another token than the one deposited
      // especially if this collateral isn't supported
      await expect(
        user.clearingHouse.withdraw(userDeposits, user.usdc.address)
      ).to.be.revertedWith(VaultErrors.UnsupportedCollateral);
    });

    it('User should not be able to access vault directly', async function () {
      await expect(
        user.vault.deposit(user.address, depositAmount, user.ua.address)
      ).to.be.revertedWith(VaultErrors.SenderNotClearingHouse);

      await expect(
        user.vault.withdraw(user.address, depositAmount, user.ua.address)
      ).to.be.revertedWith(VaultErrors.SenderNotClearingHouse);

      await expect(user.vault.settlePnL(user.address, 0)).to.be.revertedWith(
        VaultErrors.SenderNotClearingHouse
      );
    });

    it('User should not be able to withdraw more than available in vault', async function () {
      // deposit
      await depositIntoVault(user, user.ua, depositAmount);
      await user.vault.__TestVault_transfer_out(
        user.address,
        user.ua.address,
        depositAmount
      );

      // withdraw
      await expect(
        user.clearingHouse.withdraw(
          await user.vault.getReserveValue(user.address, false),
          user.ua.address
        )
      ).to.be.revertedWith(VaultErrors.InsufficientBalance);
    });
  });

  describe('Add/modify whitelisted collaterals', function () {
    it('Should not add collateral if average user tries to add collateral', async function () {
      await expect(
        user.vault.addWhiteListedCollateral(
          user.usdc.address,
          utils.parseEther('1'),
          ethers.constants.MaxUint256
        )
      ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
    });

    it('Should not add collateral if owner provides collateral with insufficient weight', async function () {
      await expect(
        deployer.vault.addWhiteListedCollateral(
          deployer.usdc.address,
          utils.parseEther('0.009'),
          ethers.constants.MaxUint256
        )
      ).to.be.revertedWith(VaultErrors.InsufficientCollateralWeight);
    });

    it('Should not add collateral if owner provides collateral with insufficient weight', async function () {
      await expect(
        deployer.vault.addWhiteListedCollateral(
          deployer.usdc.address,
          utils.parseEther('1.001'),
          ethers.constants.MaxUint256
        )
      ).to.be.revertedWith(VaultErrors.ExcessiveCollateralWeight);
    });

    it('Should not add collateral if collateral is already listed', async function () {
      await expect(
        deployer.vault.addWhiteListedCollateral(
          deployer.ua.address,
          utils.parseEther('1'),
          ethers.constants.MaxUint256
        )
      ).to.be.revertedWith(VaultErrors.CollateralAlreadyWhiteListed);
    });

    it('Should add collateral if collateral not already listed', async function () {
      const numCollaterals = await deployer.vault.getNumberOfCollaterals();
      expect(numCollaterals).to.eq(1);

      const usdcWeight = utils.parseEther('1');
      await expect(
        deployer.vault.addWhiteListedCollateral(
          deployer.usdc.address,
          usdcWeight,
          ethers.constants.MaxUint256
        )
      )
        .to.emit(deployer.vault, 'CollateralAdded')
        .withArgs(
          deployer.usdc.address,
          usdcWeight,
          ethers.constants.MaxUint256
        );

      const modifiedNumCollaterals =
        await deployer.vault.getNumberOfCollaterals();
      // whiteListedCollateral increased by 1
      expect(modifiedNumCollaterals).to.eq(2);

      // Collateral object properly initialized
      const usdcCollateral = await deployer.vault.getWhiteListedCollateral(1);
      expect(usdcCollateral).to.deep.eq([
        deployer.usdc.address,
        usdcWeight,
        await deployer.usdc.decimals(),
        BigNumber.from('0'),
        ethers.constants.MaxUint256,
      ]);

      // USDC reflected in asset to tokenIdx mapping
      expect(
        await deployer.vault.tokenToCollateralIdx(deployer.usdc.address)
      ).to.eq(1);
    });

    it('Should not change collateral parameters if average user tries to change them', async function () {
      await expect(
        user.vault.changeCollateralWeight(
          user.ua.address,
          utils.parseEther('0.5')
        )
      ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));

      await expect(
        user.vault.changeCollateralMaxAmount(
          user.ua.address,
          utils.parseEther('1000')
        )
      ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
    });

    it('Should not change collateral parameters if collateral is not listed', async function () {
      await expect(
        deployer.vault.changeCollateralWeight(
          deployer.usdc.address,
          utils.parseEther('0.5')
        )
      ).to.be.revertedWith(VaultErrors.UnsupportedCollateral);

      await expect(
        deployer.vault.changeCollateralMaxAmount(
          deployer.usdc.address,
          utils.parseEther('1000')
        )
      ).to.be.revertedWith(VaultErrors.UnsupportedCollateral);
    });

    it('Should not change weight if new weight is under the limit', async function () {
      await expect(
        deployer.vault.changeCollateralWeight(
          user.ua.address,
          utils.parseEther('0.009')
        )
      ).to.be.revertedWith(VaultErrors.InsufficientCollateralWeight);
    });

    it('Should not change weight if new weight is above the limit', async function () {
      await expect(
        deployer.vault.changeCollateralWeight(
          user.ua.address,
          utils.parseEther('1.001')
        )
      ).to.be.revertedWith(VaultErrors.ExcessiveCollateralWeight);
    });

    it('Should change weight if new weight is within in bounds, collateral is whitelisted and user is owner', async function () {
      const newUAWeight = utils.parseEther('0.5');
      await expect(
        deployer.vault.changeCollateralWeight(deployer.ua.address, newUAWeight)
      )
        .to.emit(deployer.vault, 'CollateralWeightChanged')
        .withArgs(deployer.ua.address, newUAWeight);

      const modifiedUACollateral =
        await deployer.vault.getWhiteListedCollateral(0);

      // Collateral object properly initialized
      expect(modifiedUACollateral).to.deep.eq([
        deployer.ua.address,
        newUAWeight,
        await deployer.ua.decimals(),
        BigNumber.from('0'),
        ethers.constants.MaxUint256,
      ]);
    });

    it('Should change maxAmount if collateral is whitelisted and user is owner', async function () {
      const newUAMaxAmount = utils.parseEther('1000');
      await expect(
        deployer.vault.changeCollateralMaxAmount(
          deployer.ua.address,
          newUAMaxAmount
        )
      )
        .to.emit(deployer.vault, 'CollateralMaxAmountChanged')
        .withArgs(deployer.ua.address, newUAMaxAmount);

      const modifiedUACollateral =
        await deployer.vault.getWhiteListedCollateral(0);

      // Collateral object properly initialized
      expect(modifiedUACollateral).to.deep.eq([
        deployer.ua.address,
        utils.parseEther('1'),
        await deployer.ua.decimals(),
        BigNumber.from('0'),
        newUAMaxAmount,
      ]);
    });
    it('Should support ERC4626 as collateral', async function () {
      // add USDC to Oracle
      const chainlinkOracleAddress = getChainlinkOracle(env, 'USDC');
      await deployer.oracle.setOracle(
        user.usdc.address,
        chainlinkOracleAddress,
        FOREX_HEARTBEAT,
        false
      );

      // create a big token
      await env.deployments.deploy('TestERC4626', {
        from: deployer.address,
        args: [
          'Mock aUSDC Vault',
          'Mock Aave USD token Vault',
          user.usdc.address,
        ],
      });
      const vaultToken = await ethers.getContract(
        'TestERC4626',
        deployer.address
      );
      const userT = await addTokenToUser(user, vaultToken, 'vaultToken');

      // whitelist token in Vault & Oracle
      await deployer.vault.addWhiteListedCollateral(
        vaultToken.address,
        utils.parseEther('1'),
        ethers.constants.MaxUint256
      );
      await expect(
        deployer.oracle.setOracle(
          vaultToken.address,
          chainlinkOracleAddress,
          FOREX_HEARTBEAT,
          true
        )
      )
        .to.emit(deployer.oracle, 'OracleUpdated')
        .withArgs(user.usdc.address, chainlinkOracleAddress, true);

      // get vault token balance
      const usdcAmount = await convertToCurrencyDecimals(userT.usdc, '1000');
      await setUSDCBalance(env, userT.usdc, userT.address, usdcAmount);
      expect(await userT.usdc.balanceOf(userT.address)).to.be.eq(usdcAmount);

      await userT.usdc.approve(vaultToken.address, usdcAmount);
      await userT.vaultToken.deposit(usdcAmount, userT.address);

      // balances after one deposit
      expect(await user.usdc.balanceOf(vaultToken.address)).to.be.eq(
        usdcAmount
      );
      const shares = await vaultToken.balanceOf(userT.address);
      expect(shares).to.be.eq(asBigNumber('1000'));

      // price after one deposit
      expect(await vaultToken.convertToAssets(shares)).to.be.eq(usdcAmount);
      expect(await user.oracle.getPrice(vaultToken.address, WAD)).to.be.eq(WAD);
      expect(await user.oracle.getPrice(user.usdc.address, WAD)).to.be.eq(WAD);

      // increase price of vault token
      await setUSDCBalance(env, userT.usdc, userT.address, usdcAmount);
      await userT.usdc.transfer(vaultToken.address, usdcAmount);

      // balances after increase price
      expect(await user.usdc.balanceOf(vaultToken.address)).to.be.eq(
        usdcAmount.mul(2)
      );

      // price after increase price
      expect(await vaultToken.convertToAssets(shares)).to.be.eq(
        usdcAmount.mul(2)
      );
      expect(await user.oracle.getPrice(vaultToken.address, WAD)).to.be.eq(
        WAD.mul(2)
      );
    });
  });
});
