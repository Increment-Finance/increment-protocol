import {scenarioActions} from '../../scripts/scenario-testnet/helpers';
import {createUABalance, setup, User} from '../helpers/setup';

describe('Increment App: Scenario test network script', function () {
  let deployer: User, user: User;

  beforeEach('Set up', async () => {
    ({deployer, user} = await setup());

    await createUABalance([deployer, user], 1_000_000);
    console.log('Get setup');
  });

  describe('Scenario script', function () {
    it('Can run scenario testnet script', async function () {
      // initial deployment
      await scenarioActions(deployer, user);

      // test run a second time
      await scenarioActions(deployer, user);
    });
  });
});
