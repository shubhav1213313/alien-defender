require('dotenv').config({ quiet: true });
const config = require('./config/env');
const { createApp } = require('./app');

const app = createApp();

app.listen(config.port, () => {
  console.log(`Alien Defender running at http://localhost:${config.port}`);
});
