import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

import {
  getVaultVersionToUse,
  getOracleConfig,
} from '../helpers/contracts-deployments';
import {getChainlinkOracle} from '../helpers/contracts-getters';
import {hours} from '../helpers/time';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  // Update this for networks that have a ZK-SYNC sequencer deployed
  // for them use getChainlinkOracle(hre, 'SEQUENCER')
  const isNetworkWithoutSequencerUptimeFeed = true;
  if (isNetworkWithoutSequencerUptimeFeed) {
    await hre.deployments.deploy('MockAggregator', {
      from: deployer,
      args: [8],
      log: true,
    });

    console.log('We have deployed mock sequencer uptime feed');
  }

  const sequencerUptimeFeed = await ethers.getContract(
    'MockAggregator',
    deployer
  );

  const config = getOracleConfig();

  await hre.deployments.deploy('Oracle', {
    from: deployer,
    args: [sequencerUptimeFeed.address, config.gracePeriod],
    log: true,
  });

  const ua = await ethers.getContract('UA', deployer);
  const oracle = await ethers.getContract('Oracle', deployer);
  const vault = await ethers.getContract(getVaultVersionToUse(hre), deployer);

  // add UA to Oracle with a fixed price of 1
  const usdcChainlinkOracle = getChainlinkOracle(hre, 'USDC');
  const forexHeartBeat = hours(25);
  await (
    await oracle.setOracle(
      ua.address,
      usdcChainlinkOracle,
      forexHeartBeat,
      false
    )
  ).wait();
  await (
    await oracle.setFixedPrice(ua.address, ethers.utils.parseEther('1'))
  ).wait();

  // register the oracle in the vault
  if ((await vault.oracle()) !== oracle.address) {
    await (await vault.setOracle(oracle.address)).wait();
  }
  console.log('We have deployed the oracle');
};

func.tags = ['Oracle'];
func.id = 'deploy_oracle_contract';
func.dependencies = ['UA', 'Vault'];

export default func;
