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

// Функция для формата даты МойСклад
function getMoyskladDate() {
  const d = new Date();
  const pad = n => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Получение id и типа атрибута "Номер телефона" для заказов
async function getPhoneAttributeMeta() {
  try {
    const resp = await axios.get(
      `${MOYSKLAD_API}/entity/customerorder/metadata/attributes`,
      {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/json;charset=utf-8',
        },
      }
    );
    const attr = resp.data.rows.find(a => a.name === 'Номер телефона');
    return attr ? { id: attr.id, type: attr.type } : null;
  } catch (e) {
    console.error('❌ Не удалось получить мета атрибута "Номер телефона":', e.response?.data || e.message);
    return null;
  }
}

app.post('/webhook/order', async (req, res) => {
  try {
    console.log('📩 Headers:', req.headers);
    console.log('📦 Body:', req.body);

    const order = req.body;

    // 1. Создаем/ищем контрагента
    let counterparty;
    const phone = order.Phone || order['Телефон'] || '';
    if (!phone) {
      console.error('❌ Не передан номер телефона!');
      return res.status(200).json({ status: 'error', error: 'phone_required' });
    }
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
            name: order.Name || order.Email || phone,
            email: order.Email,
            phone: phone,
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
      return res.status(200).json({ status: 'error', error: 'counterparty', details: e.response?.data });
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
          return res.status(200).json({ status: 'error', error: 'product', details: e.response?.data });
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
        return res.status(200).json({ status: 'error', error: 'organization' });
      }
    } catch (e) {
      console.error('❌ Ошибка при получении организации:', e.response?.data || e.message);
      return res.status(200).json({ status: 'error', error: 'organization', details: e.response?.data });
    }

    // 4. Создаем заказ покупателя
    try {
      console.log('📝 Создаю заказ покупателя в МойСклад...');
      const phoneAttributeMeta = await getPhoneAttributeMeta();
      const orderData = {
        organization: { meta: organization.meta },
        agent: { meta: counterparty.meta },
        positions,
        description: `Заказ с лендинга. Город: ${order['Город'] || ''}, Адрес: ${order['Улица_дом_квартира'] || ''}`,
        deliveryPlannedMoment: getMoyskladDate(),
      };
      if (phoneAttributeMeta) {
        let phoneValue = phone;
        if (phoneAttributeMeta.type === 'long') {
          // Оставляем только цифры
          phoneValue = String(phone).replace(/\D/g, '');
          if (!phoneValue) phoneValue = '0';
        }
        orderData.attributes = [
          {
            meta: {
              href: `${MOYSKLAD_API}/entity/customerorder/metadata/attributes/${phoneAttributeMeta.id}`,
              type: 'attributemetadata',
              mediaType: 'application/json',
            },
            value: phoneAttributeMeta.type === 'long' ? Number(phoneValue) : phoneValue,
          },
        ];
        console.log(`Добавлен атрибут "Номер телефона" (${phoneAttributeMeta.type}) в заказ:`, phoneValue);
      } else {
        console.warn('⚠️ Не найден id атрибута "Номер телефона" для заказа.');
      }
      console.log('Данные для создания заказа:', orderData);
      await axios.post(
        `${MOYSKLAD_API}/entity/customerorder`,
        orderData,
        {
          headers: {
            Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json;charset=utf-8',
          },
        }
      );
      console.log('✅ Заказ успешно создан в МойСклад!');
      res.status(200).json({ status: 'ok' });
    } catch (e) {
      console.error('❌ Ошибка при создании заказа:', e.response?.data || e.message);
      return res.status(200).json({ status: 'error', error: 'order', details: e.response?.data });
    }
  } catch (e) {
    console.error('❌ Необработанная ошибка:', e);
    return res.status(200).json({ status: 'error', error: 'unexpected', details: e.message });
  }
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
