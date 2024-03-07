import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  // deploy math contract
  await hre.deployments.deploy('CurveMath', {
    from: deployer,
    log: true,
  });
  console.log('We have deployed CurveMath');

  // constructor arguments
  const math = await ethers.getContract('CurveMath', deployer);

  // deploy curve crypto views contract
  await hre.deployments.deploy('CurveCryptoViews', {
    from: deployer,
    args: [math.address],
    log: true,
  });
  console.log('We have deployed CurveCryptoViews');
};

func.tags = ['CurveCryptoViews'];
func.id = 'deploy_curveCryptoViews';
func.dependencies = ['VirtualTokens'];

export default func;
