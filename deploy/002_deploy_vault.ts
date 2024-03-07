import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

import {getVaultVersionToUse} from '../helpers/contracts-deployments';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  const ua = await ethers.getContract('UA', deployer);

  // deploy vault
  const vaultVersionToUse = getVaultVersionToUse(hre);
  await hre.deployments.deploy(vaultVersionToUse, {
    from: deployer,
    args: [ua.address],
    log: true,
  });
  console.log('We have deployed the vault');
};

func.tags = ['Vault'];
func.id = 'deploy_vault_contract';
func.dependencies = ['UA'];

export default func;
