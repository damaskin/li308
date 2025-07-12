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

app.post('/tilda-debug', (req, res) => {
  const fs = require('fs');
  const log = {
    time: new Date(),
    headers: req.headers,
    body: req.body,
  };
  fs.appendFileSync('tilda_log.txt', JSON.stringify(log, null, 2) + '\n');
  res.status(200).json({ status: 'logged' });
});


app.get('/test', (req, res) => {
  res.status(200).json({ message: 'Сервер работает' });
});

app.listen(PORT, () => {
  console.log(`Backend запущен на порту ${PORT}`);
});

/*
Пример структуры данных, приходящих в webhook после оформления покупки:
{
  Name: 'IVAN DAMASCHIN',
  'Ваша_фамилия': 'DAMASCHIN',
  Email: 'janrayn@gmail.com',
  Phone: '+7 (900) 000-00-00',
  'Доставка': 'Доставка CDEK по РФ согласуется с менеджером',
  'Город': 'Tiraspol',
  'Улица_дом_квартира': 'Moldova, Tiraspol, Odesa 145, 10',
  Checkbox: 'yes',
  Checkbox_2: 'yes',
  payment: {
    orderid: '1445725799',
    products: [ [Object] ],
    amount: '50600',
    subtotal: '50600',
    delivery: 'Доставка CDEK по РФ согласуется с менеджером',
    delivery_price: 0,
    delivery_fio: '',
    delivery_address: '',
    delivery_comment: ''
  },
  COOKIES: '__ddg9_=184.22.77.69; __ddg8_=tmJGAHHM1r4174Dz; __ddg10_=1752336073;tildauid=ddd1b4ecbb48d489f1dfe548227b4182',
  formid: 'form1102463091',
  formname: 'Cart'
}
*/
