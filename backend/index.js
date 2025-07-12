require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 4300;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello World!')
})
app.post('/webhook/order', (req, res) => {
  console.log('📩 Headers:', req.headers);
  console.log('📦 Body:', req.body);
  res.status(200).json({ status: 'ok' });
});


app.get('/test', (req, res) => {
  res.status(200).json({ message: 'Сервер работает' });
});

app.listen(PORT, () => {
  console.log(`Backend запущен на порту ${PORT}`);
});
