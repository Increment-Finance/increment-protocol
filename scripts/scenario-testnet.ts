import {scenarioActions, scenarioSetup} from './scenario-testnet/helpers';

async function scenarioTestnet() {
  // setup
  const {deployer, user} = await scenarioSetup();

  // Scenario
  await scenarioActions(deployer, user);
}

scenarioTestnet()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
