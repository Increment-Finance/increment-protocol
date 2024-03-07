import {expect} from 'chai';
import env, {ethers} from 'hardhat';
import {BigNumber, BigNumberish} from 'ethers';
import {deployMockContract, MockContract} from 'ethereum-waffle';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/dist/src/signers';

import MockAggregator from '../../artifacts/contracts/mocks/MockAggregator.sol/MockAggregator.json';

import {OracleErrors, AccessControlErrors} from '../../helpers/errors';
import {WAD, ZERO_ADDRESS, DEAD_ADDRESS} from '../../helpers/constants';
import {getLatestTimestamp} from '../../helpers/misc-utils';
import {minutes, hours} from '../../helpers/time';
import {getOracleConfig} from '../../helpers/contracts-deployments';

import {Oracle, IERC20Metadata} from '../../typechain';

const ONE_ETH = ethers.utils.parseEther('1');
const FOREX_HEARTBEAT = hours(25);
const VALID_GRACE_PERIOD = minutes(10);

let deployer, user: SignerWithAddress;

async function _setUp() {
  [deployer, user] = await ethers.getSigners();

  // create aggregator mock
  const aggregatorMock = await deployMockContract(deployer, MockAggregator.abi);
  const sequencerUptimeFeedMock = await deployMockContract(
    deployer,
    MockAggregator.abi
  );

  // create mock ERC20 token
  const MockTokenContract = await ethers.getContractFactory('USDCmock');
  const mockToken = <IERC20Metadata>(
    await MockTokenContract.deploy('MOCK', 'Mock Token', 18)
  );

  // deploy Oracle contract
  const OracleContract = await ethers.getContractFactory('Oracle');
  const oracle = <Oracle>(
    await OracleContract.deploy(
      sequencerUptimeFeedMock.address,
      getOracleConfig().gracePeriod
    )
  );

  return {
    oracle,
    token: mockToken,
    aggregator: aggregatorMock,
    sequencerUptimeFeed: sequencerUptimeFeedMock,
  };
}

describe('Oracle', () => {
  let oracle: Oracle;
  let token: IERC20Metadata;
  let aggregator: MockContract; // weird type to please TS
  let sequencerUptimeFeed: MockContract; // weird type to please TS

  let snapshotId: number;

  async function _setAggregatorParams(
    aggregatorMock: MockContract,
    decimals: number,
    price: BigNumber,
    updatedAt: BigNumberish
  ): Promise<void> {
    await aggregatorMock.mock.decimals.returns(decimals);
    const roundId = 1000;
    const startedAt = 1653548040; // arbitrary value
    const answeredInRound = 0;
    await aggregatorMock.mock.latestRoundData.returns(
      roundId,
      price,
      startedAt,
      updatedAt,
      answeredInRound
    );
  }

  // sequencerStatus: 0 = up, 1 = down
  async function _setSequencerUptimeFeedMock(
    sequencerStatus: BigNumberish = 0,
    sequencerStatusLastUpdatedAt: BigNumberish = 0
  ): Promise<void> {
    await sequencerUptimeFeed.mock.latestRoundData.returns(
      0,
      sequencerStatus,
      sequencerStatusLastUpdatedAt,
      0,
      0
    );
  }

  before(async () => {
    ({oracle, token, aggregator, sequencerUptimeFeed} = await _setUp());

    // take snapshot
    snapshotId = await env.network.provider.send('evm_snapshot', []);
  });

  beforeEach(async () => {
    await _setSequencerUptimeFeedMock();

    await _setAggregatorParams(
      aggregator,
      18,
      ONE_ETH,
      await getLatestTimestamp(env)
    );
  });

  afterEach(async () => {
    await env.network.provider.send('evm_revert', [snapshotId]);
    snapshotId = await env.network.provider.send('evm_snapshot', []);
  });

  it('Should fail to set fixed price if not governance address', async () => {
    await expect(
      oracle
        .connect(user)
        .setOracle(token.address, aggregator.address, FOREX_HEARTBEAT, false)
    ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
  });

  it('Should fail to add aggregator if aggregator or asset have 0 address', async () => {
    await expect(
      oracle.setOracle(ZERO_ADDRESS, aggregator.address, FOREX_HEARTBEAT, false)
    ).to.be.revertedWith(OracleErrors.AssetZeroAddress);

    await expect(
      oracle.setOracle(token.address, ZERO_ADDRESS, FOREX_HEARTBEAT, false)
    ).to.be.revertedWith(OracleErrors.AggregatorZeroAddress);
  });

  it('Should add an aggregator', async () => {
    const asset = token.address;

    expect((await oracle.assetToOracles(asset)).aggregator).to.eq(ZERO_ADDRESS);

    await expect(
      oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false)
    )
      .to.emit(oracle, 'OracleUpdated')
      .withArgs(asset, aggregator.address, false);

    expect((await oracle.assetToOracles(asset)).aggregator).to.eq(
      aggregator.address
    );
  });

  it('Should fail to return spot price if oracle price is 0', async () => {
    await _setAggregatorParams(
      aggregator,
      18,
      BigNumber.from('0'),
      await getLatestTimestamp(env)
    );

    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);

    await expect(oracle.getPrice(asset, WAD)).to.be.revertedWith(
      OracleErrors.InvalidRoundPrice
    );
  });

  it('Should fail when L2 sequencer is down', async () => {
    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);

    await _setSequencerUptimeFeedMock(1, 0);

    await expect(oracle.getPrice(asset, WAD)).to.be.revertedWith(
      OracleErrors.SequencerDown
    );
  });

  it('Should fail when L2 sequencer is back but before the end of the grace period', async () => {
    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);

    const gracePeriod = await oracle.gracePeriod();
    const currentTimestamp = BigNumber.from(
      (await getLatestTimestamp(env)).toString()
    );
    // block.timestamp - sequencerStatusLastUpdatedAt <= gracePeriod
    // block.timestamp - gracePeriod <= sequencerStatusLastUpdatedAt
    const sequencerStatusLastUpdatedAtLimit = currentTimestamp
      .sub(gracePeriod)
      .add(10); // +10 as a safety margin

    await _setSequencerUptimeFeedMock(0, sequencerStatusLastUpdatedAtLimit);

    await expect(oracle.getPrice(asset, WAD)).to.be.revertedWith(
      OracleErrors.GracePeriodNotOver
    );
  });

  it('Should fail to return spot price if timestamp of the price feed is too old', async () => {
    const currentTimestamp = BigNumber.from(
      (await getLatestTimestamp(env)).toString()
    );
    const oldTimestamp = currentTimestamp.sub(FOREX_HEARTBEAT).sub(100); // buffer

    await _setAggregatorParams(aggregator, 18, ONE_ETH, oldTimestamp);

    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);

    await expect(oracle.getPrice(asset, WAD)).to.be.revertedWith(
      OracleErrors.DataNotFresh
    );
  });

  it('Should get spot price of asset with data feeds of 18 decimals', async () => {
    await _setAggregatorParams(
      aggregator,
      18,
      ONE_ETH,
      await getLatestTimestamp(env)
    );

    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);

    expect(await oracle.getPrice(asset, WAD)).to.eq(ONE_ETH);
  });

  it('Should get spot price of asset with data feeds of less than 18 decimals', async () => {
    const one = ethers.BigNumber.from('100000000');
    await _setAggregatorParams(
      aggregator,
      8,
      one,
      await getLatestTimestamp(env)
    );

    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);

    expect(await oracle.getPrice(asset, WAD)).to.eq(ONE_ETH);
  });

  it('Should get spot price of asset with data feeds of more than 18 decimals', async () => {
    const one = ethers.utils.parseEther('1000000');
    await _setAggregatorParams(
      aggregator,
      24,
      one,
      await getLatestTimestamp(env)
    );

    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);

    expect(await oracle.getPrice(asset, WAD)).to.eq(ONE_ETH);
  });

  it('Should fail to set fixed price if not governance address', async () => {
    await expect(
      oracle.connect(user).setFixedPrice(token.address, ONE_ETH)
    ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
  });

  it('Should fail to set fixed price to unsupported asset', async () => {
    await expect(
      oracle.setFixedPrice(token.address, ONE_ETH)
    ).to.be.revertedWith(OracleErrors.UnsupportedAsset);
  });

  it('Should work to set and use fixed price', async () => {
    const asset = token.address;
    await oracle.setOracle(asset, aggregator.address, FOREX_HEARTBEAT, false);
    await expect(oracle.setFixedPrice(asset, ONE_ETH))
      .to.emit(oracle, 'AssetGotFixedPrice')
      .withArgs(asset, ONE_ETH);

    expect((await oracle.assetToOracles(asset)).fixedPrice).to.eq(ONE_ETH);
    expect(await oracle.getPrice(asset, WAD)).to.eq(ONE_ETH);
  });

  it('Should fail to set new heart beat if not governance address', async () => {
    await expect(
      oracle.connect(user).setHeartBeat(token.address, 0)
    ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
  });

  it('Should work to set and use new heart beat', async () => {
    const currentTimestamp = BigNumber.from(
      (await getLatestTimestamp(env)).toString()
    );
    const limitButValidTimestamp = currentTimestamp
      .sub(FOREX_HEARTBEAT)
      .add(100); // buffer

    await _setAggregatorParams(aggregator, 18, ONE_ETH, limitButValidTimestamp);

    const asset = token.address;
    await oracle.setOracle(
      token.address,
      aggregator.address,
      FOREX_HEARTBEAT,
      false
    );

    await expect(oracle.getPrice(asset, WAD)).to.not.be.revertedWith(
      OracleErrors.DataNotFresh
    );

    const oneHour = 60 * 60;
    await oracle.setHeartBeat(token.address, oneHour);

    await expect(oracle.getPrice(asset, WAD)).to.be.revertedWith(
      OracleErrors.DataNotFresh
    );
  });

  it('Should fail to set new sequencer uptime feed if not governance address', async () => {
    await expect(
      oracle.connect(user).setSequencerUptimeFeed(token.address)
    ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
  });

  it('Should fail to set new sequencer uptime feed if 0 address', async () => {
    await expect(
      oracle.setSequencerUptimeFeed(ZERO_ADDRESS)
    ).to.be.revertedWith(OracleErrors.SequencerUptimeFeedZeroAddress);
  });

  it('Should work to set new valid sequencer uptime feed', async () => {
    await expect(oracle.setSequencerUptimeFeed(DEAD_ADDRESS))
      .to.emit(oracle, 'SequencerUptimeFeedUpdated')
      .withArgs(DEAD_ADDRESS);

    expect(await oracle.sequencerUptimeFeed()).to.not.eq(
      sequencerUptimeFeed.address
    );
    await expect(oracle.setSequencerUptimeFeed(sequencerUptimeFeed.address))
      .to.emit(oracle, 'SequencerUptimeFeedUpdated')
      .withArgs(sequencerUptimeFeed.address);
    expect(await oracle.sequencerUptimeFeed()).to.eq(
      sequencerUptimeFeed.address
    );
  });

  it('Should fail to set new grace period if not governance address', async () => {
    await expect(
      oracle.connect(user).setGracePeriod(VALID_GRACE_PERIOD)
    ).to.be.revertedWith(AccessControlErrors.revertGovernance(user.address));
  });

  it('Should fail to set new grace period if not within bounds', async () => {
    const gracePeriodTooLow = 59;
    await expect(oracle.setGracePeriod(gracePeriodTooLow)).to.be.revertedWith(
      OracleErrors.IncorrectGracePeriod
    );

    const gracePeriodTooHigh = 3601;
    await expect(oracle.setGracePeriod(gracePeriodTooHigh)).to.be.revertedWith(
      OracleErrors.IncorrectGracePeriod
    );
  });

  it('Should work to set new valid grace period', async () => {
    expect(await oracle.gracePeriod()).to.not.eq(VALID_GRACE_PERIOD);

    await expect(oracle.setGracePeriod(VALID_GRACE_PERIOD))
      .to.emit(oracle, 'GracePeriodUpdated')
      .withArgs(VALID_GRACE_PERIOD);

    expect(await oracle.gracePeriod()).to.eq(VALID_GRACE_PERIOD);
  });
});
