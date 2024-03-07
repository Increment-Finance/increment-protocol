import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

import {getReserveAddress} from '../helpers/contracts-getters';
import {fundAccountsHardhat} from '../helpers/misc-utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log(`Current network is ${hre.network.name.toString()}`);

  const {deployer} = await hre.getNamedAccounts();

  // fund initial account
  if (hre.network.name === 'tenderly' || hre.network.name === 'localhost') {
    await fundAccountsHardhat([deployer], hre);
  }

  // deploy reserve token when testnet
  const isTestnet =
    hre.network.name === 'kovan' ||
    hre.network.name === 'rinkeby' ||
    hre.network.name === 'zktestnet';
  if (isTestnet) {
    await hre.deployments.deploy('USDCmock', {
      from: deployer,
      args: ['USDC', 'USDC Mock', 6],
      log: true,
    });

    console.log('We have deployed mock reserve token');
  }

  const maxUint256 = ethers.constants.MaxUint256;
  const uaConstructorArgs = isTestnet
    ? [(await ethers.getContract('USDCmock')).address, maxUint256]
    : [getReserveAddress('USDC', hre), maxUint256];

  await hre.deployments.deploy('UA', {
    from: deployer,
    args: uaConstructorArgs,
    log: true,
  });
  console.log('We have deployed the UA token');
};

func.tags = ['UA'];
func.id = 'deploy_UA_token';

export default func;
