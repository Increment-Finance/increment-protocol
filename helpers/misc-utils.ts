import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {eEthereumNetwork} from '../helpers/types';
import {deployments} from 'hardhat';

import {Contract} from 'ethers';
import {ethers} from 'hardhat';
import {ContractTransaction, ContractReceipt} from 'ethers';
import {Result} from 'ethers/lib/utils';

export const waitForTx = async (
  tx: ContractTransaction
): Promise<ContractReceipt> => await tx.wait(1);

export async function parseEvent(
  tx: ContractTransaction,
  eventSignature: string
): Promise<Result | undefined> {
  // from: https://github.com/ethers-io/ethers.js/issues/487
  const receipts = await tx.wait();

  if (!receipts.events) {
    throw new Error('No event found in block');
  }

  for (const event of receipts.events) {
    if (event.eventSignature === eventSignature) {
      if (!event.args) {
        throw new Error('No event args found in event');
      }
      return event.args;
    }
  }
}

export async function parseErrorValues(
  tx: Promise<ContractTransaction>
): Promise<string[]> {
  try {
    await tx;
  } catch (err) {
    const {message} = err as Error;
    const params = message
      .match(/(\()(.*)(?=\))/)?.[0]
      .slice(1)
      .split(', ');
    return params ?? [];
  }
  return [];
}

export async function setupUsers<T extends {[contractName: string]: Contract}>(
  addresses: string[],
  contracts: T
): Promise<({address: string} & T)[]> {
  const users: ({address: string} & T)[] = [];
  for (const address of addresses) {
    users.push(await setupUser(address, contracts));
  }
  return users;
}

export async function setupUser<T extends {[contractName: string]: Contract}>(
  address: string,
  contracts: T
): Promise<{address: string} & T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user: any = {address};
  for (const key of Object.keys(contracts)) {
    user[key] = contracts[key].connect(await ethers.getSigner(address));
  }
  return user as {address: string} & T;
}

export async function impersonateAccountsHardhat(
  accounts: string[],
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax
  for (const account of accounts) {
    // eslint-disable-next-line no-await-in-loop
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [account],
    });
  }
}

export async function fundAccountsHardhat(
  accounts: string[],
  hre: HardhatRuntimeEnvironment,
  amount = '0x56bc75e2d63100000' // 100 ETH
): Promise<void> {
  for (const account of accounts) {
    await hre.network.provider.send('hardhat_setBalance', [account, amount]);
  }
}

let nextBlockTimestamp = 1000000000;
export async function setNextBlockTimestamp(
  hre: HardhatRuntimeEnvironment
): Promise<number> {
  nextBlockTimestamp += 1000000000;

  await hre.network.provider.request({
    method: 'evm_setNextBlockTimestamp',
    params: [nextBlockTimestamp],
  });

  return nextBlockTimestamp;
}
export async function increaseTimeAndMine(
  hre: HardhatRuntimeEnvironment,
  amount: number
): Promise<void> {
  await increaseTime(hre, amount);
  await hre.network.provider.send('evm_mine', []);
}

export async function increaseTime(
  hre: HardhatRuntimeEnvironment,
  amount: number
): Promise<void> {
  await hre.network.provider.request({
    method: 'evm_increaseTime',
    params: [amount],
  });
}

export function getEthereumNetworkFromString(String: string): eEthereumNetwork {
  if (Object.values(eEthereumNetwork).some((col: string) => col === String)) {
    return <eEthereumNetwork>String;
  } else {
    try {
      throw new Error(
        `Network ${String} not found in eEthereumNetwork. Mainnet assumed`
      );
    } catch (e) {
      console.log(e);
    }
    return <eEthereumNetwork>'none';
  }
}

export function getEthereumNetworkFromHRE(
  hre: HardhatRuntimeEnvironment
): eEthereumNetwork {
  let networkString: string = hre.network.name;
  if (networkString === 'localhost') {
    networkString = 'hardhat';
  }

  const networkEnum: eEthereumNetwork =
    getEthereumNetworkFromString(networkString);
  return networkEnum;
}

export async function logDeployments(): Promise<void> {
  const allDeployments = await deployments.all();

  for (const [contractName, contractData] of Object.entries(allDeployments)) {
    console.log(`At ${contractData.address} we deployed ${contractName}`);
  }

  /*console.log('Accounts are', {
    namedAccounts: await getNamedAccounts(),
    unnamedAccounts: await getUnnamedAccounts(),
  });*/
}

export async function getLatestTimestamp(
  hre: HardhatRuntimeEnvironment
): Promise<number> {
  const blockNumber = await hre.ethers.provider.getBlockNumber();
  const block = await hre.ethers.provider.getBlock(blockNumber);
  return block.timestamp;
}

export async function setNextBlockTimestampWithArg(
  hre: HardhatRuntimeEnvironment,
  timestamp: number
): Promise<number> {
  await hre.network.provider.request({
    method: 'evm_setNextBlockTimestamp',
    params: [timestamp],
  });

  await hre.network.provider.send('evm_mine', []);

  return timestamp;
}

export async function revertTimeAndSnapshot(
  env: HardhatRuntimeEnvironment,
  snapshotId: number,
  time: number
): Promise<number> {
  /*
   Some tests need a combination of taking snapshots and setting timestamps to work,
   since reverting the evm does not revert the time!!!

   Further, you can not set timestamp to a time before the current time.
   You can circumvent this restriction by first reverting to an evm state in the past and
   then setting the timing of the next block.
  */

  await env.network.provider.send('evm_revert', [snapshotId]);
  const newSnapshot = await env.network.provider.send('evm_snapshot', []);

  await setNextBlockTimestampWithArg(env, time);
  return newSnapshot;
}
