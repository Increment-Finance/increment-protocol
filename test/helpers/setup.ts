import {
  ethers,
  deployments,
  getUnnamedAccounts,
  getNamedAccounts,
} from 'hardhat';
import env = require('hardhat');

// helpers
import {
  getReserveAddress,
  getCryptoSwap,
  getCryptoSwapFactory,
  getCurveToken,
} from '../../helpers/contracts-getters';
import {tokenToWad} from '../../helpers/contracts-helpers';
import {setupUser, setupUsers, logDeployments} from '../../helpers/misc-utils';
import {convertToCurrencyDecimals} from '../../helpers/contracts-helpers';
import {setUSDCBalance} from './utils/manipulateStorage';

// types
import {
  UA,
  IERC20Metadata,
  TestPerpetual,
  TestVault,
  VirtualToken,
  VBase,
  TestInsurance,
  ClearingHouse,
  ClearingHouseViewer,
  Oracle,
  CurveMath,
  CurveCryptoViews,
  CurveTokenV5,
  CurveCryptoSwap2ETH,
  Factory,
} from '../../typechain';

import {BigNumber} from '../../helpers/types';
import {
  getInsuranceVersionToUse,
  getPerpetualVersionToUse,
  getVaultVersionToUse,
} from '../../helpers/contracts-deployments';

export type User = {address: string} & Contracts;

export type Contracts = {
  perpetual: TestPerpetual;
  vault: TestVault;
  ua: UA;
  usdc: IERC20Metadata;
  vBase: VBase;
  vQuote: VirtualToken;
  market: CurveCryptoSwap2ETH;
  clearingHouse: ClearingHouse;
  clearingHouseViewer: ClearingHouseViewer;
  insurance: TestInsurance;
  oracle: Oracle;
  factory: Factory;
  curveToken: CurveTokenV5;
  math: CurveMath;
  curveViews: CurveCryptoViews;
};

export interface TestEnv {
  deployer: User;
  user: User;
  bob: User;
  alice: User;
  trader: User;
  traderTwo: User;
  lp: User;
  lpTwo: User;
  users: User[];
}

/// @notice: get all deployed contracts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getContracts = async (
  deployAccount: string
): Promise<Contracts> => {
  const usdcAddress = getReserveAddress('USDC', env);

  const vBase = <VBase>await ethers.getContract('VBase', deployAccount);
  const vQuote = <VirtualToken>(
    await ethers.getContract('VQuote', deployAccount)
  );

  const factory = await getCryptoSwapFactory(env);
  const cryptoswap = await getCryptoSwap(
    factory,
    vQuote.address,
    vBase.address
  );

  return {
    factory: <Factory>factory,
    market: <CurveCryptoSwap2ETH>cryptoswap,
    curveToken: <CurveTokenV5>await getCurveToken(cryptoswap),
    math: <CurveMath>await ethers.getContract('CurveMath', deployAccount),
    curveViews: <CurveCryptoViews>(
      await ethers.getContract('CurveCryptoViews', deployAccount)
    ),
    vBase,
    vQuote,
    vault: <TestVault>(
      await ethers.getContract(getVaultVersionToUse(env), deployAccount)
    ),
    perpetual: <TestPerpetual>(
      await ethers.getContract(getPerpetualVersionToUse(env), deployAccount)
    ),
    insurance: <TestInsurance>(
      await ethers.getContract(getInsuranceVersionToUse(env), deployAccount)
    ),
    oracle: <Oracle>await ethers.getContract('Oracle', deployAccount),
    ua: <UA>await ethers.getContract('UA', deployAccount),
    usdc: <IERC20Metadata>(
      await ethers.getContractAt('ERC20', usdcAddress, deployAccount)
    ),
    clearingHouse: <ClearingHouse>(
      await ethers.getContract('ClearingHouse', deployAccount)
    ),
    clearingHouseViewer: <ClearingHouseViewer>(
      await ethers.getContract('ClearingHouseViewer', deployAccount)
    ),
  };
};

export async function createUABalance(
  accounts: User[],
  amount = 10000
): Promise<BigNumber> {
  const usdcAmount = await convertToCurrencyDecimals(
    accounts[0].usdc,
    amount.toString()
  );

  for (const account of accounts) {
    await setUSDCBalance(env, account.usdc, account.address, usdcAmount);

    await account.usdc.approve(account.ua.address, usdcAmount);
    await account.ua.mintWithReserve(0, usdcAmount);
  }

  const uaAmount = tokenToWad(await accounts[0].usdc.decimals(), usdcAmount);

  return uaAmount;
}

/// @notice: Main deployment function
export const setup = deployments.createFixture(async (): Promise<TestEnv> => {
  // get contracts
  await deployments.fixture(['ClearingHouseViewer', 'Perpetual']);

  await logDeployments();
  const {deployer, bob, alice, user, trader, traderTwo, lp, lpTwo} =
    await getNamedAccounts();
  const contracts = await getContracts(deployer);

  // container
  const testEnv: TestEnv = {} as TestEnv;

  testEnv.deployer = await setupUser(deployer, contracts);
  testEnv.user = await setupUser(user, contracts);
  testEnv.bob = await setupUser(bob, contracts);
  testEnv.alice = await setupUser(alice, contracts);
  testEnv.trader = await setupUser(trader, contracts);
  testEnv.traderTwo = await setupUser(traderTwo, contracts);
  testEnv.lp = await setupUser(lp, contracts);
  testEnv.lpTwo = await setupUser(lpTwo, contracts);
  testEnv.users = await setupUsers(await getUnnamedAccounts(), contracts);

  return testEnv;
});
