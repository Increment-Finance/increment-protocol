import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

import {getChainlinkOracle} from '../helpers/contracts-getters';
import {getVBaseConfig} from '../helpers/contracts-deployments';

/// @dev Unlike in the code where it makes sense to keep the abstract `vBase` and `vQuote`,
/// the deployment script needs to contain the exact names.
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  const sequencerUptimeFeed = await ethers.getContract(
    'MockAggregator',
    deployer
  );
  const config = getVBaseConfig('EUR_USD');

  await hre.deployments.deploy('VBase', {
    from: deployer,
    args: [
      'vEUR base token',
      'vEUR',
      getChainlinkOracle(hre, 'EUR_USD'),
      config.heartBeat,
      sequencerUptimeFeed.address,
      config.gracePeriod,
    ],
    log: true,
  });
  console.log('We have deployed vEUR');

  await hre.deployments.deploy('VQuote', {
    from: deployer,
    args: ['vUSD quote token', 'vUSD'],
    log: true,
  });
  console.log('We have deployed vUSD');
};

func.tags = ['VirtualTokens'];
func.id = 'deploy_virtual_tokens';
func.dependencies = ['ClearingHouse'];

export default func;
