import {expect} from 'chai';
import {
  HardhatRuntimeEnvironment,
  HttpNetworkHDAccountsConfig,
} from 'hardhat/types';

import {Deployer} from '@matterlabs/hardhat-zksync-deploy';

import {BigNumber} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {utils, Wallet} from 'zksync-web3';
import env from 'hardhat';

async function getDeployerWallet(
  hre: HardhatRuntimeEnvironment
): Promise<Deployer> {
  // get mnemonic from hardhat config
  const mnemonic = (<HttpNetworkHDAccountsConfig>(
    hre.config.networks.zktestnet.accounts
  )).mnemonic;
  expect(mnemonic).to.not.be.null;

  // get zk wallet from mnemonic
  const wallet = Wallet.fromMnemonic(mnemonic);
  const deployerZk = new Deployer(hre, wallet);
  return deployerZk;
}

async function fundZkSync(
  hre: HardhatRuntimeEnvironment,
  depositAmount: BigNumber = parseEther('0.0001')
) {
  const deployerZk = await getDeployerWallet(hre);

  // check
  const l1Balance = await deployerZk.zkWallet
    .connectToL1(hre.ethers.provider)
    ._providerL1()
    .getBalance(deployerZk.zkWallet.address);
  expect(l1Balance.sub(depositAmount)).to.be.gt(0);

  // Deposit some funds to L2 in order to be able to perform L2 transactions.
  console.log('depositing into L2 ...');
  const depositHandle = await deployerZk.zkWallet.deposit({
    to: deployerZk.zkWallet.address,
    token: utils.ETH_ADDRESS,
    amount: depositAmount,
  });

  // Wait until the deposit is processed on zkSync
  await depositHandle.wait();
  console.log('deposit successful');
}

const test = true;
// verify the contract by running: `yarn hardhat run scripts/tenderly.ts --network tenderly`
const main = async function () {
  const hre = env;

  const {deployer} = await hre.getNamedAccounts();

  // fund zkSync
  const balance = await hre.ethers.provider.getBalance(deployer);
  if (test || balance.eq(0)) {
    await fundZkSync(hre);
  }

  console.log(`deployer balance is ${balance}`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
