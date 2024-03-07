import {ethers} from 'hardhat';
import {utils} from 'ethers';
import {IERC20Metadata} from '../typechain';
import {BigNumber} from './types';

// @author: convert string to BigNumber with token decimals
export async function convertToCurrencyDecimals(
  token: IERC20Metadata,
  amount: string
): Promise<BigNumber> {
  const decimals = (await token.decimals()).toString();
  return utils.parseUnits(amount, decimals);
}
export async function convertToCurrencyUnits(
  token: IERC20Metadata,
  amount: BigNumber
): Promise<string> {
  const decimals = await token.decimals();
  return utils.formatUnits(amount, decimals);
}

// @author: convert BigNumber with tokenDecimals to BigNumber with 18 decimals
export async function tokenToWad(
  tokenDecimals: number | BigNumber,
  amount: BigNumber
): Promise<BigNumber> {
  const amountAsString = utils.formatUnits(amount, tokenDecimals);
  return utils.parseEther(amountAsString);
}

// @author: convert BigNumber with 18 decimals to BigNumber with tokenDecimals
export async function wadToToken(
  decimals: number,
  amount: BigNumber
): Promise<BigNumber> {
  const amountAsString = utils.formatEther(amount);
  return utils.parseUnits(amountAsString, decimals);
}

export async function getBlockTime(): Promise<number> {
  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  return blockBefore.timestamp;
}
