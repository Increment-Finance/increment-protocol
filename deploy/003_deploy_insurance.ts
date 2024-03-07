import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

import {
  getInsuranceVersionToUse,
  getVaultVersionToUse,
} from '../helpers/contracts-deployments';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();

  const vault = await ethers.getContract(getVaultVersionToUse(hre), deployer);
  const ua = await ethers.getContract('UA', deployer);

  const insuranceVersion = getInsuranceVersionToUse(hre);
  await hre.deployments.deploy(insuranceVersion, {
    from: deployer,
    args: [ua.address, vault.address],
    log: true,
  });

  // register insurance in vault
  const insurance = await ethers.getContract(insuranceVersion, deployer);

  if ((await vault.insurance()) !== insurance.address) {
    await (await vault.setInsurance(insurance.address)).wait();
  }
  console.log('We have deployed the insurance');
};

func.tags = ['Insurance'];
func.id = 'deploy_insurance_contract';
func.dependencies = ['UA', 'Vault'];

export default func;
