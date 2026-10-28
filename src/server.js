const { openDatabase } = require('./db');
const { createApp } = require('./app');

const db = openDatabase();
const app = createApp({ db });
const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`CodeCrew Portal running at http://localhost:${port}`);
});
