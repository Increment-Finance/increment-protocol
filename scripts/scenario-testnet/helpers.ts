import {ethers, getNamedAccounts} from 'hardhat';

import {Side} from '../../test/helpers/utils/types';
import {setupUsers} from '../../helpers/misc-utils';
import {wadToToken} from '../../helpers/contracts-helpers';
import {
  extendPositionWithCollateral,
  closePosition,
  depositCollateralAndProvideLiquidity,
  removeLiquidity,
  withdrawCollateral,
  mintUA,
} from '../../test/helpers/PerpetualUtilsFunctions';
import env = require('hardhat');

import {
  VirtualToken,
  Vault,
  Perpetual,
  Insurance,
  USDCmock,
  IERC20,
  ClearingHouse,
  ClearingHouseViewer,
  Oracle,
  UA,
  VBase,
} from '../../typechain';

import {CurveCryptoSwapTest, CurveTokenV5Test} from '../../typechain';

import {User} from '../../test/helpers/setup';
import {asBigNumber} from '../../test/helpers/utils/calculations';
import {BigNumber, tEthereumAddress} from '../../helpers/types';
import {
  getCryptoSwapVersionToUse,
  getCurveTokenVersionToUse,
} from '../../helpers/contracts-deployments';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getContractsKovan = async (deployAccount: string): Promise<any> => {
  console.log(`get contract on network ${env.network.name}`);
  return {
    vBase: <VBase>await ethers.getContract('VBase', deployAccount),
    vQuote: <VirtualToken>await ethers.getContract('VQuote', deployAccount),
    vault: <Vault>await ethers.getContract('Vault', deployAccount),
    perpetual: <Perpetual>await ethers.getContract('Perpetual', deployAccount),
    insurance: <Insurance>await ethers.getContract('Insurance', deployAccount),
    oracle: <Oracle>await ethers.getContract('Oracle', deployAccount),
    ua: <UA>await ethers.getContract('UA', deployAccount),
    usdc: <IERC20>await ethers.getContract('USDCmock', deployAccount),
    clearingHouse: <ClearingHouse>(
      await ethers.getContract('ClearingHouse', deployAccount)
    ),
    clearingHouseViewer: <ClearingHouseViewer>(
      await ethers.getContract('ClearingHouseViewer', deployAccount)
    ),
    market: <CurveCryptoSwapTest>(
      await ethers.getContract(getCryptoSwapVersionToUse(env), deployAccount)
    ),
    curveToken: <CurveTokenV5Test>(
      await ethers.getContract(getCurveTokenVersionToUse(env), deployAccount)
    ),
  };
};

async function fundAccounts(
  user: User,
  amount: BigNumber, // 18 decimals precision
  accounts: tEthereumAddress[]
) {
  const usdcMock = await (<USDCmock>user.usdc);
  if ((await usdcMock.owner()) !== user.address) {
    throw 'User can not mint tokens';
  }
  const tokenAmount = await wadToToken(await user.usdc.decimals(), amount);

  for (const account of accounts) {
    await (await usdcMock.mint(account, tokenAmount)).wait();
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function closeExistingPosition(user: User) {
  // We force traders / lps to close their position before opening a new one
  const traderPosition = await user.clearingHouseViewer.getTraderPosition(
    0,
    user.address
  );
  if (
    !traderPosition.positionSize.isZero() ||
    !traderPosition.openNotional.isZero()
  ) {
    console.log('Closing existing position');
    await closePosition(user, user.ua);
  }
  const reserveValue = await user.clearingHouseViewer.getReserveValue(
    user.address,
    false
  );
  if (!reserveValue.isZero()) {
    console.log(
      'Withdraw remaining collateral of ' +
        ethers.utils.formatEther(reserveValue)
    );
    await withdrawCollateral(user, user.ua);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function withdrawExistingLiquidity(user: User) {
  // We force traders / lps to close their position before opening a new one
  const liquidityPosition = await user.perpetual.getLpPosition(user.address);
  if (!liquidityPosition.liquidityBalance.isZero()) {
    console.log('Withdraw available liquidity and settle');
    await removeLiquidity(user);
  } else {
    console.log('No liquidity to withdraw');
  }
}

export async function setupAccounts(): Promise<{
  deployer: User;
  user: User;
  liquidator: User;
  frontend: User;
  backend: User;
  tester: User;
}> {
  const users = await getNamedAccounts();
  const contracts = await getContractsKovan(users.deployer);
  const [deployer, user, liquidator, frontend, backend, tester] =
    await setupUsers(Object.values(users), contracts);
  return {deployer, user, liquidator, frontend, backend, tester};
}

export async function scenarioSetup() {
  console.log(`Starting scenario testnet on network ${env.network.name}`);

  if (
    !(
      env.network.name == 'kovan' ||
      env.network.name == 'rinkeby' ||
      env.network.name == 'hardhat' ||
      env.network.name == 'zktestnet'
    )
  ) {
    throw new Error(
      'Run script on network rinkeby (via appending --network rinkeby)'
    );
  }

  // Setup
  const {deployer, user, liquidator, frontend, backend, tester} =
    await setupAccounts();

  const usdcMock = <USDCmock>deployer.usdc;

  if ((await usdcMock.owner()) === deployer.address) {
    console.log(deployer.address);
    console.log('Fund accounts');
    await fundAccounts(deployer, asBigNumber('10000'), [
      user.address,
      liquidator.address,
      frontend.address,
      backend.address,
      tester.address,
    ]);
    await fundAccounts(deployer, asBigNumber('500000'), [deployer.address]);
    await mintUA(deployer, asBigNumber('500000'));

    // do not whitelist collateral by default
    // console.log('Whitelist USDC as collateral');
    // await whiteListUSDCAsCollateral(deployer, env);
  }

  return {deployer, user, liquidator, frontend, backend, tester};
}

export async function scenarioActions(deployer: User, user: User) {
  const tradeSize = asBigNumber('100');

  /* provide initial liquidity */
  if ((await deployer.curveToken.totalSupply()).isZero()) {
    // set-up initial ua liquidity
    console.log('Provide initial liquidity');
    await depositCollateralAndProvideLiquidity(
      deployer,
      deployer.ua,
      asBigNumber('500000')
    );
  }

  /* open short position */
  await closeExistingPosition(user);
  await extendPositionWithCollateral(
    user,
    user.ua,
    tradeSize,
    tradeSize.mul(10),
    Side.Short
  );

  /* open long position */
  await closeExistingPosition(user);
  await extendPositionWithCollateral(
    user,
    user.ua,
    tradeSize,
    tradeSize.mul(10),
    Side.Short
  );
}
