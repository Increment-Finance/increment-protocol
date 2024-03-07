import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {
  getPerpetualConfigs,
  getPerpetualVersionToUse,
} from '../helpers/contracts-deployments';
import {
  getCryptoSwap,
  getCryptoSwapFactory,
} from '../helpers/contracts-getters';

import {ClearingHouse, Perpetual} from '../typechain';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  const vEUR = await ethers.getContract('VBase', deployer);
  const vUSD = await ethers.getContract('VQuote', deployer);
  const cryptoViews = await ethers.getContract('CurveCryptoViews', deployer);

  let cryptoswap;
  if (
    hre.network.name === 'kovan' ||
    hre.network.name === 'rinkeby' ||
    hre.network.name === 'zktestnet'
  ) {
    cryptoswap = await ethers.getContract('CurveCryptoSwapTest', deployer);
  } else {
    const factory = await getCryptoSwapFactory(hre);
    cryptoswap = await getCryptoSwap(factory, vUSD.address, vEUR.address);
  }

  // deploy perpetual contract
  const clearingHouse = <ClearingHouse>(
    await ethers.getContract('ClearingHouse', deployer)
  );

  const config = getPerpetualConfigs('EUR_USD');

  const perpetualArgs = [
    vEUR.address,
    vUSD.address,
    cryptoswap.address,
    clearingHouse.address,
    cryptoViews.address,
    config,
  ];

  console.log('Get ready to launch ...');

  const perpetualVersionToUse = getPerpetualVersionToUse(hre);

  console.log('launching with version: ', perpetualVersionToUse);

  await hre.deployments.deploy(perpetualVersionToUse, {
    from: deployer,
    args: perpetualArgs,
    log: true,
  });
  const perpetual = <Perpetual>(
    await ethers.getContract(perpetualVersionToUse, deployer)
  );

  console.log('We have deployed Perpetual');

  // register vEUR/vUSD in clearingHouse, register perpetual in clearingHouse

  if ((await vEUR.perp()) !== perpetual.address) {
    await (await vEUR.transferPerpOwner(perpetual.address)).wait();
  }

  if ((await vUSD.perp()) !== perpetual.address) {
    await (await vUSD.transferPerpOwner(perpetual.address)).wait();
  }

  if ((await clearingHouse.getNumMarkets()).eq(0)) {
    await (await clearingHouse.allowListPerpetual(perpetual.address)).wait();
  }

  console.log('We have registered the Perpetual');
};

func.tags = ['Perpetual'];
func.id = 'deploy_perpetual_contract';
func.dependencies = [
  'VirtualTokens',
  'CurvePool',
  'ClearingHouse',
  'CurveCryptoViews',
];

export default func;
