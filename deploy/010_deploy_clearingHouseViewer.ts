import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  const clearingHouse = await ethers.getContract('ClearingHouse', deployer);

  // deploy clearingHouseViewer
  await hre.deployments.deploy('ClearingHouseViewer', {
    from: deployer,
    args: [clearingHouse.address],
    log: true,
  });

  console.log('We have deployed the ClearingHouseViewer');
};

func.tags = ['ClearingHouseViewer'];
func.id = 'deploy_clearing_house_viewer';
func.dependencies = ['ClearingHouse'];

export default func;
