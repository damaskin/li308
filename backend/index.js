require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 4300;
const axios = require('axios');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello World!')
})

const MOYSKLAD_TOKEN = '69469f40e487322489f25eb9ae6346592241e614';
const MOYSKLAD_API = 'https://api.moysklad.ru/api/remap/1.2';

app.post('/webhook/order', async (req, res) => {
  console.log('📩 Headers:', req.headers);
  console.log('📦 Body:', req.body);

  const order = req.body;

  // 1. Создаем/ищем контрагента
  let counterparty;
  try {
    const searchQuery = order.Email ? `?search=${encodeURIComponent(order.Email)}` : '';
    console.log('🔎 Ищу контрагента в МойСклад...');
    const findResp = await axios.get(
      `${MOYSKLAD_API}/entity/counterparty${searchQuery}`,
      {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/json;charset=utf-8',
        },
      }
    );
    if (findResp.data.rows && findResp.data.rows.length > 0) {
      counterparty = findResp.data.rows[0];
      console.log('✅ Контрагент найден:', counterparty.name);
    } else {
      console.log('➕ Контрагент не найден, создаю нового...');
      const createResp = await axios.post(
        `${MOYSKLAD_API}/entity/counterparty`,
        {
          name: order.Name || order.Email || order.Phone,
          email: order.Email,
          phone: order.Phone,
        },
        {
          headers: {
            Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json;charset=utf-8',
          },
        }
      );
      counterparty = createResp.data;
      console.log('✅ Контрагент создан:', counterparty.name);
    }
  } catch (e) {
    console.error('❌ Ошибка при работе с контрагентом:', e.response?.data || e.message);
    return res.status(500).json({ status: 'error', error: 'counterparty' });
  }

  // 2. Формируем массив позиций заказа
  const positions = [];
  if (order.payment && Array.isArray(order.payment.products)) {
    for (const p of order.payment.products) {
      // Поиск товара по имени
      let product;
      try {
        console.log(`🔎 Ищу товар "${p.name}" в МойСклад...`);
        const findProduct = await axios.get(
          `${MOYSKLAD_API}/entity/product?search=${encodeURIComponent(p.name)}`,
          {
            headers: {
              Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
              'Content-Type': 'application/json',
              Accept: 'application/json;charset=utf-8',
            },
          }
        );
        if (findProduct.data.rows && findProduct.data.rows.length > 0) {
          product = findProduct.data.rows[0];
          console.log('✅ Товар найден:', product.name);
        } else {
          console.log('➕ Товар не найден, создаю новый...');
          const createProduct = await axios.post(
            `${MOYSKLAD_API}/entity/product`,
            {
              name: p.name,
              code: p.sku || undefined,
              salePrices: [{ value: Number(p.price) * 100, currency: { meta: { href: `${MOYSKLAD_API}/entity/currency/00000000-0000-0000-0000-000000000000`, type: 'currency', mediaType: 'application/json' } } }],
            },
            {
              headers: {
                Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
                'Content-Type': 'application/json',
                Accept: 'application/json;charset=utf-8',
              },
            }
          );
          product = createProduct.data;
          console.log('✅ Товар создан:', product.name);
        }
      } catch (e) {
        console.error('❌ Ошибка при работе с товаром:', e.response?.data || e.message);
        return res.status(500).json({ status: 'error', error: 'product' });
      }
      positions.push({
        quantity: Number(p.quantity) || 1,
        price: Number(p.price) * 100,
        assortment: { meta: product.meta },
      });
    }
  }

  // 3. Получаем организацию
  let organization;
  try {
    console.log('🔎 Получаю организацию из МойСклад...');
    const orgResp = await axios.get(
      `${MOYSKLAD_API}/entity/organization`,
      {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/json;charset=utf-8',
        },
      }
    );
    if (orgResp.data.rows && orgResp.data.rows.length > 0) {
      console.log('Список организаций:', orgResp.data.rows.map(o => ({ name: o.name, id: o.id, href: o.meta.href })));
      organization = orgResp.data.rows[0];
      console.log('✅ Организация найдена:', organization.name);
    } else {
      console.error('❌ Не найдено ни одной организации в МойСклад!');
      return res.status(500).json({ status: 'error', error: 'organization' });
    }
  } catch (e) {
    console.error('❌ Ошибка при получении организации:', e.response?.data || e.message);
    return res.status(500).json({ status: 'error', error: 'organization' });
  }

  // 4. Создаем заказ покупателя
  try {
    console.log('📝 Создаю заказ покупателя в МойСклад...');
    await axios.post(
      `${MOYSKLAD_API}/entity/customerorder`,
      {
        organization: { meta: organization.meta },
        agent: { meta: counterparty.meta },
        positions,
        description: `Заказ с лендинга. Город: ${order['Город'] || ''}, Адрес: ${order['Улица_дом_квартира'] || ''}`,
        deliveryPlannedMoment: new Date().toISOString(),
      },
      {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/json;charset=utf-8',
        },
      }
    );
    console.log('✅ Заказ успешно создан в МойСклад!');
  } catch (e) {
    console.error('❌ Ошибка при создании заказа:', e.response?.data || e.message);
    return res.status(500).json({ status: 'error', error: 'order' });
  }

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
