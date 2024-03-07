import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {BigNumber, tEthereumAddress} from '../../../helpers/types';
import {getReserveAddress} from '../../../helpers/contracts-getters';
import {ethers} from 'hardhat';

import {AggregatorV3Interface, IERC20} from '../../../typechain';
import {expect} from 'chai';

/**
 *@notice set USDC balance (tested for mainnet, 16/02/2022)
 */
export async function setUSDCBalance(
  hre: HardhatRuntimeEnvironment,
  usdc: IERC20,
  account: tEthereumAddress,
  amount: BigNumber
): Promise<void> {
  if (usdc.address != getReserveAddress('USDC', hre)) {
    throw new Error('USDC contract address does not match');
  } else {
    const USDC_ADDRESS = usdc.address;
    const USDC_SLOT = 9; // check for yourself by running 'yarn hardhat run ./scripts/storageSlots.ts' (only works for mainnet!)

    // Get storage slot index
    const index = ethers.utils
      .solidityKeccak256(
        ['uint256', 'uint256'],
        [account, USDC_SLOT] // key, slot
      )
      .replace(/0x0+/, '0x');

    // Manipulate local balance (needs to be bytes32 string)
    await setStorageAt(USDC_ADDRESS, index, toBytes32(amount).toString());
  }
}

/**
  *@notice get the Aggregator round (NOT OCR round) in which last report was transmitted
  (see  https://etherscan.io/address/0x02f878a94a1ae1b15705acd65b5519a46fe3517e#code)
*/
export async function setLatestChainlinkPrice(
  hre: HardhatRuntimeEnvironment,
  chainlinkOracle: AggregatorV3Interface,
  price: BigNumber
): Promise<void> {
  const latestRound = (await chainlinkOracle.latestRoundData())[4];
  await setChainlinkPrice(hre, chainlinkOracle, price, latestRound);
}

// manipulate the chainlink storage price (attention: tested for the EUR_USD price feed on mainnet (01/2021))
export async function setChainlinkPrice(
  hre: HardhatRuntimeEnvironment,
  chainlinkOracle: AggregatorV3Interface,
  price: BigNumber,
  roundId: BigNumber
): Promise<void> {
  const aggregatorRoundId = await calcAggregatorRound(roundId);

  const aggregator = await getChainlinkAggregator(hre, chainlinkOracle.address);

  const PRICE_SLOT = 43; // check for yourself by running 'yarn hardhat run ./scripts/chainlinkPriceSlots.ts' (only tested for EUR_USD / mainnet!)

  // Get storage slot index
  let probedSlot = hre.ethers.utils
    .keccak256(
      encode(['uint32', 'uint'], [aggregatorRoundId, PRICE_SLOT]) // key, slot
    )
    .replace(/0x0+/, '0x');

  // remove padding for JSON RPC
  while (probedSlot.startsWith('0x0')) probedSlot = '0x' + probedSlot.slice(3);

  // set price in shared storage
  const prev = await hre.network.provider.send('eth_getStorageAt', [
    aggregator,
    probedSlot,
    'latest',
  ]);

  const _timestamp = ethers.utils.hexDataSlice(prev, 0, 64 / 8);

  // Manipulate local balance (needs to be bytes32 string)
  await setStorageAt(
    aggregator,
    probedSlot,
    ethers.utils.solidityPack(['uint64', 'int192'], [_timestamp, price])
  );

  // checks
  const roundAnswer = (await chainlinkOracle.getRoundData(roundId))[1];
  expect(roundAnswer).to.be.equal(price);

  const answer = (await chainlinkOracle.latestRoundData())[1];
  expect(answer).to.be.equal(price);
}
/*************************************************** UTIL FUNCTIONS *************************************************/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const encode = (types: any, values: any) =>
  ethers.utils.defaultAbiCoder.encode(types, values);

const toBytes32 = (bn: BigNumber) => {
  return ethers.utils.hexlify(ethers.utils.zeroPad(bn.toHexString(), 32));
};

const setStorageAt = async (
  address: tEthereumAddress,
  index: string,
  value: string
) => {
  await ethers.provider.send('hardhat_setStorageAt', [address, index, value]);
  await ethers.provider.send('evm_mine', []); // Just mines to the next block
};

/* Returns the aggregator contract of a given chainlink price feed (tested w/ AggregatorV3Interface)
   To understand the role of the aggregator contract reference the docs (https://docs.chain.link/docs/architecture-overview/)
   The aggregator contracts stores the price updates retrieved by the AggregatorInterface
 https://github.com/smartcontractkit/chainlink/blob/7a0555fa2e7692ed9c6c7490999614529e5c40ba/contracts/src/v0.7/dev/AggregatorProxy.sol#L257
*/
async function getChainlinkAggregator(
  hre: HardhatRuntimeEnvironment,
  chainlinkOracleAddress: tEthereumAddress
): Promise<tEthereumAddress> {
  const aggregator = await (
    await hre.ethers.getContractAt(
      ['function aggregator() view returns (address)'],
      chainlinkOracleAddress
    )
  ).aggregator();
  return aggregator;
}

/**
  *@notice get the Aggregator round (NOT OCR round) in which last report was transmitted
  (see  https://etherscan.io/address/0x02f878a94a1ae1b15705acd65b5519a46fe3517e#code)
*/
async function calcAggregatorRound(
  answeredInRound: BigNumber
): Promise<BigNumber> {
  /*


  Function extracts the aggregator round id (originalId) from the chainlinkOracle roundId (answeredInRound)

  answeredInRound = uint80((uint256(phase) << 64) | originalId);

  where originalId is the id of the aggregator contract (uint64)
  and the phase is the phase id (uint8)

  answeredInRound is stored as uint80 like below (as bytes)

  <phase>    <<<<<<<<<<<<<< originalId >>>>>>>>>>>>>>>>
  0     1    2    3    4    5    6    7    8    9    10


  We are searching for the originalId.


  question: Why not extract the originalId directly from the aggregator contract?
  answer:   We can not call the aggregator call directly since there is an checkAccess() modifier

  ref. https://github.com/smartcontractkit/chainlink/blob/7a0555fa2e7692ed9c6c7490999614529e5c40ba/contracts/src/v0.7/dev/AggregatorProxy.sol#L340

  TS implementation of https://github.com/smartcontractkit/chainlink/blob/7a0555fa2e7692ed9c6c7490999614529e5c40ba/contracts/src/v0.7/dev/AggregatorProxy.sol#L344

  */

  // pad to 10 bytes
  const hexAnsweredInRound = ethers.utils.hexZeroPad(
    ethers.utils.hexValue(answeredInRound),
    10
  );

  // extract originalId
  const originalId = ethers.utils.hexDataSlice(hexAnsweredInRound, 2, 10);

  return BigNumber.from(originalId);
}
