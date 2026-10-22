import { createApp } from './app.js';

const PORT = process.env.PORT || 8000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`WA Fire Analytics & Behavior API listening on http://127.0.0.1:${PORT}`);
  console.log(`GET / for the endpoint index.`);
});
