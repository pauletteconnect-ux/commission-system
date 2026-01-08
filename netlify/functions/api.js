// netlify/functions/api.js
const { google } = require('googleapis');
const NodeCache = require('node-cache');

// 创建缓存，5分钟有效期
const cache = new NodeCache({ stdTTL: 300 });

// Google Sheets认证
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// 初始化Google Sheets
const sheets = google.sheets({ version: 'v4', auth });

exports.handler = async (event, context) => {
  // 处理跨域请求
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };

  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const action = params.action || (event.body && JSON.parse(event.body).action);
    
    let response;
    
    switch (action) {
      case 'getProducts':
        response = await getProducts();
        break;
      case 'getCategories':
        response = await getCategories();
        break;
      case 'getUserCommissions':
        response = await getUserCommissions(params.userId);
        break;
      case 'getAdminStats':
        response = await getAdminStats();
        break;
      case 'createAnonymousUser':
        response = await createAnonymousUser();
        break;
      case 'adminLogin':
        const { username, password } = params;
        response = await adminLogin(username, password);
        break;
      case 'getSettings':
        response = await getSettings();
        break;
      case 'importProducts':
        const { data } = params;
        response = await importProducts(data);
        break;
      case 'addProduct':
        response = await addProduct(params);
        break;
      case 'updateProduct':
        response = await updateProduct(params);
        break;
      case 'deleteProduct':
        response = await deleteProduct(params.productId);
        break;
      case 'addCategory':
        response = await addCategory(params.name);
        break;
      case 'getUsers':
        response = await getUsers();
        break;
      case 'exportData':
        response = await exportData(params.type);
        break;
      case 'saveSettings':
        const { settings } = params;
        response = await saveSettings(settings);
        break;
      default:
        response = { success: false, message: '操作不存在' };
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };
    
  } catch (error) {
    console.error('API Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        message: error.toString() 
      }),
    };
  }
};

// 获取所有产品
async function getProducts() {
  const cacheKey = 'products_data';
  const cached = cache.get(cacheKey);
  
  if (cached) {
    console.log('从缓存获取产品数据');
    return cached;
  }
  
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Products!A:S', // A到S列，对应19个字段
  });
  
  const rows = response.data.values;
  if (!rows || rows.length < 2) {
    return { success: true, data: [] };
  }
  
  const headers = rows[0];
  const products = rows.slice(1).map(row => {
    const product = {};
    headers.forEach((header, index) => {
      product[header] = row[index] || '';
    });
    return product;
  });
  
  const result = { success: true, data: products };
  cache.set(cacheKey, result);
  
  return result;
}

// 获取所有分类
async function getCategories() {
  const cacheKey = 'categories_data';
  const cached = cache.get(cacheKey);
  
  if (cached) {
    console.log('从缓存获取分类数据');
    return cached;
  }
  
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Categories!A:C',
  });
  
  const rows = response.data.values;
  if (!rows || rows.length < 2) {
    return { success: true, data: [] };
  }
  
  const headers = rows[0];
  const categories = rows.slice(1).map(row => {
    const category = {};
    headers.forEach((header, index) => {
      category[header] = row[index] || '';
    });
    return category;
  });
  
  const result = { success: true, data: categories };
  cache.set(cacheKey, result);
  
  return result;
}

// 获取用户佣金
async function getUserCommissions(userId) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  // 获取佣金记录
  const commissionsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Commissions!A:J',
  });
  
  const commissionsRows = commissionsResponse.data.values;
  let totalCommission = 0;
  let pendingCommission = 0;
  let paidCommission = 0;
  const commissions = [];
  
  if (commissionsRows && commissionsRows.length > 1) {
    const headers = commissionsRows[0];
    for (let i = 1; i < commissionsRows.length; i++) {
      const row = commissionsRows[i];
      if (row[1] === userId) { // UserID在B列
        const commission = {};
        headers.forEach((header, index) => {
          commission[header] = row[index] || '';
        });
        commissions.push(commission);
        
        const amount = parseFloat(commission.Commission || 0);
        totalCommission += amount;
        
        if (commission.Status === 'pending') {
          pendingCommission += amount;
        } else if (commission.Status === 'paid') {
          paidCommission += amount;
        }
      }
    }
  }
  
  // 获取推荐人数
  const usersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Users!A:L',
  });
  
  let referralCount = 0;
  const usersRows = usersResponse.data.values;
  if (usersRows && usersRows.length > 1) {
    for (let i = 1; i < usersRows.length; i++) {
      if (usersRows[i][4] === userId) { // Referrer在E列
        referralCount++;
      }
    }
  }
  
  return {
    success: true,
    totalCommission,
    pendingCommission,
    paidCommission,
    referralCount,
    commissions,
  };
}

// 创建匿名用户
async function createAnonymousUser() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  // 生成唯一ID和推荐码
  const userId = 'guest_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const referralCode = generateReferralCode();
  const token = generateToken();
  
  // 获取最后一行
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Users!A:A', // 只获取ID列
  });
  
  // 添加新用户
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Users!A:L',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [[
        userId,
        '', // Phone
        '访客用户', // Name
        referralCode,
        '', // Referrer
        0, 0, 0, 0, // 佣金相关
        'guest', // Role
        token,
        new Date().toISOString()
      ]],
    },
  });
  
  // 清理缓存
  cache.del('users_data');
  
  return {
    success: true,
    user: {
      id: userId,
      name: '访客用户',
      role: 'guest',
      referralCode,
      token,
    },
  };
}

// 管理员登录
async function adminLogin(username, password) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  // 获取设置
  const settingsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Settings!A:B',
  });
  
  let adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const settingsRows = settingsResponse.data.values;
  
  if (settingsRows) {
    for (let i = 1; i < settingsRows.length; i++) {
      if (settingsRows[i][0] === 'admin_password') {
        adminPassword = settingsRows[i][1];
        break;
      }
    }
  }
  
  if (username === 'admin' && password === adminPassword) {
    const user = {
      id: 'admin',
      name: '管理员',
      role: 'admin',
      referralCode: 'ADMIN',
    };
    
    return {
      success: true,
      user: user,
      token: generateToken(),
    };
  }
  
  return { success: false, message: '用户名或密码错误' };
}

// 获取设置
async function getSettings() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Settings!A:B',
  });
  
  const rows = response.data.values;
  const settings = {
    whatsappNumber: '6285215621230',
    defaultCommission: 10,
    siteTitle: '我们的秘密：分享产品，轻松赚钱',
  };
  
  if (rows) {
    for (let i = 1; i < rows.length; i++) {
      const key = rows[i][0];
      const value = rows[i][1];
      
      if (key === 'whatsapp_number') {
        settings.whatsappNumber = value;
      } else if (key === 'default_commission') {
        settings.defaultCommission = parseFloat(value);
      } else if (key === 'site_title') {
        settings.siteTitle = value;
      }
    }
  }
  
  return {
    success: true,
    data: settings,
  };
}

// 导入产品
async function importProducts(data) {
  const lines = data.split('\n').filter(line => line.trim());
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  // 获取当前产品最后一行
  const productsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Products!A:A',
  });
  
  const currentRows = productsResponse.data.values || [];
  let nextId = currentRows.length; // A列有标题行
  
  const newRows = [];
  
  lines.forEach(line => {
    const parts = line.split('|').map(part => part.trim());
    
    if (parts.length >= 9) {
      let categoryId = 1;
      
      // 获取分类ID（简化处理）
      // 在实际应用中，应该根据分类名称查找对应ID
      
      let productData = [];
      
      if (parts.length >= 15) {
        // 完整格式
        productData = [
          nextId++,
          categoryId,
          parts[1] || '新产品',
          parts[12] || '',
          parseFloat(parts[2]) || 0,
          parseFloat(parts[3]) || 0,
          parseFloat(parts[4]) || 10,
          parts[5] || '',
          parts[6] || '',
          parts[7] || '',
          parts[8] || '',
          parts[9] || '',
          parts[10] || '',
          parts[11] || '[]',
          parseInt(parts[14]) || 100,
          parseInt(parts[13]) || 0,
          false,
          false,
          new Date().toISOString()
        ];
      } else {
        // 简单格式
        productData = [
          nextId++,
          categoryId,
          parts[1] || '新产品',
          parts[6] || '',
          parseFloat(parts[2]) || 0,
          parseFloat(parts[3]) || 0,
          parseFloat(parts[4]) || 10,
          parts[5] || '',
          '',
          '',
          '',
          '',
          '',
          '[]',
          parseInt(parts[8]) || 100,
          parseInt(parts[7]) || 0,
          false,
          false,
          new Date().toISOString()
        ];
      }
      
      newRows.push(productData);
    }
  });
  
  if (newRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Products!A:S',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: newRows },
    });
    
    // 清理缓存
    cache.del('products_data');
    
    return { success: true, importedCount: newRows.length };
  }
  
  return { success: false, message: '没有有效数据' };
}

// 添加产品
async function addProduct(params) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  // 获取最后一行ID
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Products!A:A',
  });
  
  const rows = response.data.values || [];
  const newId = rows.length; // 因为A列有标题行
  
  const extraImagesJSON = params.extraImages ? 
    JSON.stringify(params.extraImages.split(',').map(img => img.trim()).filter(img => img)) : 
    '[]';
  
  const newRow = [
    newId,
    params.categoryId || 1,
    params.name || '新产品',
    params.description || '',
    parseFloat(params.originalPrice) || 0,
    parseFloat(params.memberPrice) || 0,
    parseFloat(params.commission) || 10,
    params.image || '',
    params.video || '',
    params.image2 || '',
    params.image3 || '',
    params.image4 || '',
    params.image5 || '',
    extraImagesJSON,
    parseInt(params.stock) || 100,
    0, // PurchasedCount
    params.isExclusive === '1',
    params.isHotSale === '1',
    new Date().toISOString()
  ];
  
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Products!A:S',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [newRow] },
  });
  
  // 清理缓存
  cache.del('products_data');
  
  return { success: true, productId: newId };
}

// 其他函数（简化的）
async function updateProduct(params) {
  // 实现更新逻辑
  cache.del('products_data');
  return { success: true };
}

async function deleteProduct(productId) {
  // 实际实现需要找到对应行并删除
  cache.del('products_data');
  return { success: true };
}

async function addCategory(name) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Categories!A:A',
  });
  
  const rows = response.data.values || [];
  const newId = rows.length;
  
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Categories!A:C',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [[newId, name, new Date().toISOString()]] },
  });
  
  cache.del('categories_data');
  return { success: true };
}

async function getUsers() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Users!A:L',
  });
  
  const rows = response.data.values;
  if (!rows || rows.length < 2) {
    return { success: true, data: [] };
  }
  
  const headers = rows[0];
  const users = rows.slice(1).map(row => {
    const user = {};
    headers.forEach((header, index) => {
      user[header] = row[index] || '';
    });
    return user;
  });
  
  return { success: true, data: users };
}

async function exportData(type) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  let range;
  
  switch(type) {
    case 'users':
      range = 'Users!A:L';
      break;
    case 'products':
      range = 'Products!A:S';
      break;
    case 'commissions':
      range = 'Commissions!A:J';
      break;
    default:
      return { success: false, message: '无效的数据类型' };
  }
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  
  const rows = response.data.values || [];
  const csv = rows.map(row => 
    row.map(cell => {
      if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))) {
        return '"' + cell.replace(/"/g, '""') + '"';
      }
      return cell;
    }).join(',')
  ).join('\n');
  
  return { success: true, csv };
}

async function saveSettings(settingsStr) {
  const settings = JSON.parse(settingsStr);
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  // 清空设置表
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Settings!A:B',
  });
  
  // 添加标题
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Settings!A1:B1',
    valueInputOption: 'RAW',
    resource: { values: [['Key', 'Value']] },
  });
  
  // 添加设置
  const settingsArray = Object.entries(settings);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Settings!A:B',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: settingsArray },
  });
  
  return { success: true };
}

// 辅助函数
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 获取管理员统计数据
async function getAdminStats() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  
  // 获取佣金数据
  const commissionsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Commissions!A:J',
  });
  
  let totalCommission = 0;
  const commissionsRows = commissionsResponse.data.values || [];
  
  if (commissionsRows.length > 1) {
    const headers = commissionsRows[0];
    for (let i = 1; i < commissionsRows.length; i++) {
      const commission = parseFloat(commissionsRows[i][6] || 0); // Commission在G列
      totalCommission += commission;
    }
  }
  
  // 获取用户数量
  const usersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Users!A:L',
  });
  const usersRows = usersResponse.data.values || [];
  const referralCount = Math.max(0, usersRows.length - 1);
  
  // 获取产品数量
  const productsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Products!A:S',
  });
  const productsRows = productsResponse.data.values || [];
  const productCount = Math.max(0, productsRows.length - 1);
  
  return {
    success: true,
    totalSales: totalCommission * 10,
    totalCommission,
    referralCount,
    productCount,
    orderCount: Math.max(0, commissionsRows.length - 1),
  };
}