import {tEthereumAddress} from '../../helpers/types';
import {ethers} from 'hardhat';
import env = require('hardhat');
import {utils, constants} from 'ethers';
import {AggregatorV3Interface} from '../../typechain';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const encode = (types: any, values: any) =>
  utils.defaultAbiCoder.encode(types, values);

// original code: https://blog.euler.finance/brute-force-storage-layout-discovery-in-erc20-contracts-with-hardhat-7ff9342143ed
// finds the balances storage slot of an erc20 contract
export async function findBalancesSlot(
  tokenAddress: tEthereumAddress
): Promise<number> {
  const account = constants.AddressZero;
  const probeA = encode(['uint'], [1]);
  const probeB = encode(['uint'], [2]);
  const token = await ethers.getContractAt('ERC20', tokenAddress);
  for (let i = 0; i < 100; i++) {
    let probedSlot = utils.keccak256(encode(['address', 'uint'], [account, i]));
    // remove padding for JSON RPC
    while (probedSlot.startsWith('0x0'))
      probedSlot = '0x' + probedSlot.slice(3);
    const prev = await env.network.provider.send('eth_getStorageAt', [
      tokenAddress,
      probedSlot,
      'latest',
    ]);
    // make sure the probe will change the slot value
    const probe = prev === probeA ? probeB : probeA;

    await env.network.provider.send('hardhat_setStorageAt', [
      tokenAddress,
      probedSlot,
      probe,
    ]);

    const balance = await token.balanceOf(account);
    // reset to previous value
    await env.network.provider.send('hardhat_setStorageAt', [
      tokenAddress,
      probedSlot,
      prev,
    ]);
    if (balance.eq(ethers.BigNumber.from(probe))) return i;
  }
  throw 'Balances slot not found!';
}

// find the price storage slot of an chainlink oracle
export async function findPriceSlot(
  chainlinkOracleAddress: tEthereumAddress
): Promise<number> {
  const probeA = encode(['int'], [1]);
  const probeB = encode(['int'], [2]);
  const chainlinkOracle: AggregatorV3Interface = await ethers.getContractAt(
    'AggregatorV3Interface',
    chainlinkOracleAddress
  );

  // get aggregator (contract where price is stored)
  // https://github.com/smartcontractkit/chainlink/blob/7a0555fa2e7692ed9c6c7490999614529e5c40ba/contracts/src/v0.7/dev/AggregatorProxy.sol#L257
  const aggregator = await (
    await ethers.getContractAt(
      ['function aggregator() view returns (address)'],
      chainlinkOracleAddress
    )
  ).aggregator();
  console.log('Changing storage slot of aggregator at address', aggregator);

  /* price is stored in the mapping s_transmissions:

  , where
  mapping(uint32 => Transmission) internal s_transmissions;

  and
  struct Transmission {
    int192 answer; // 192 bits ought to be enough for anyone
    uint64 timestamp;
  }

  storage slot of

  s_transmissions[round_id].answer

  can be calculated as:

  keccak256(uint32(round_id) . uint256(i)))

, where i is the storage location of the _s_transmissions mapping

  For reference:
https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html
*/

  // get latest round_id as uint32
  const roundId = (await chainlinkOracle.latestRoundData())[0].mod(
    ethers.BigNumber.from(ethers.BigNumber.from(2).pow(32))
  );

  console.log('try to find price slot for round_id', roundId);
  for (let i = 0; i < 100; i++) {
    let probedSlot = utils.keccak256(encode(['uint32', 'uint'], [roundId, i]));

    // remove padding for JSON RPC
    while (probedSlot.startsWith('0x0'))
      probedSlot = '0x' + probedSlot.slice(3);

    // decode storage slot
    const prev = await env.network.provider.send('eth_getStorageAt', [
      aggregator,
      probedSlot,
      'latest',
    ]);

    const _answer = ethers.utils.hexDataSlice(prev, 64 / 8, 192 / 8);
    const _timestamp = ethers.utils.hexDataSlice(prev, 0, 64 / 8);

    // set new storage slot
    const probeAnswer = _answer === probeA ? probeB : probeA; // make sure the probe will change the slot value
    const probe = ethers.utils.solidityPack(
      ['uint64', 'int192'],
      [_timestamp, probeAnswer]
    );

    await env.network.provider.send('hardhat_setStorageAt', [
      aggregator,
      probedSlot,
      probe,
    ]);

    // get price
    const answer = (await chainlinkOracle.latestRoundData())[1];

    // reset to previous value
    await env.network.provider.send('hardhat_setStorageAt', [
      aggregator,
      probedSlot,
      prev,
    ]);
    if (answer.eq(ethers.BigNumber.from(probeAnswer))) {
      return i;
    }
  }
  throw 'Price slot not found!';
}
