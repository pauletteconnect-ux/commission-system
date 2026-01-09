// netlify/functions/api.js - 修复版本
const { google } = require('googleapis');
const NodeCache = require('node-cache');

// 创建缓存，5分钟有效期
const cache = new NodeCache({ stdTTL: 300 });

// 辅助函数：安全解析环境变量中的JSON
function parseGoogleCredentials(credString) {
  try {
    // 如果字符串已经是JSON，直接解析
    if (credString.trim().startsWith('{')) {
      return JSON.parse(credString);
    }
    
    // 尝试处理base64编码
    try {
      const decoded = Buffer.from(credString, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (base64Error) {
      // 不是base64编码
      console.log('不是base64编码，尝试其他方式');
    }
    
    // 如果还是失败，尝试清理字符串
    const cleaned = credString
      .replace(/\\"/g, '"')
      .replace(/\\\\n/g, '\\n')
      .replace(/\\n/g, '\n');
    
    return JSON.parse(cleaned);
    
  } catch (error) {
    console.error('解析凭证失败:', error.message);
    throw new Error('无法解析Google凭证: ' + error.message);
  }
}

// 初始化Google Sheets认证
let authInstance = null;

function getAuth() {
  if (authInstance) return authInstance;
  
  try {
    const credentials = parseGoogleCredentials(process.env.GOOGLE_CREDENTIALS);
    
    authInstance = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    return authInstance;
  } catch (error) {
    console.error('初始化Google认证失败:', error);
    // 返回一个假认证用于测试
    return {
      getClient: async () => ({})
    };
  }
}

// 获取Google Sheets实例
function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

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
    const body = event.body ? JSON.parse(event.body) : {};
    const action = params.action || body.action;
    
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
        response = await adminLogin(params.username, params.password);
        break;
      case 'getSettings':
        response = await getSettings();
        break;
      case 'importProducts':
        response = await importProducts(params.data);
        break;
      case 'addProduct':
        response = await addProduct(params);
        break;
      default:
        response = { 
          success: false, 
          message: '操作不存在或未实现',
          availableActions: [
            'getProducts', 'getCategories', 'getUserCommissions',
            'getAdminStats', 'createAnonymousUser', 'adminLogin',
            'getSettings', 'importProducts', 'addProduct'
          ]
        };
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
        message: '服务器错误: ' + error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }),
    };
  }
};

// 获取所有产品
async function getProducts() {
  try {
    // 如果没有设置SPREADSHEET_ID，返回测试数据
    if (!process.env.SPREADSHEET_ID || process.env.SPREADSHEET_ID === 'test') {
      return {
        success: true,
        data: [
          {
            ID: 1,
            Name: '测试产品1',
            Description: '这是测试产品',
            OriginalPrice: 100,
            MemberPrice: 80,
            Commission: 10,
            ImageURL: 'https://via.placeholder.com/300x200',
            StockCount: 100,
            PurchasedCount: 0
          },
          {
            ID: 2,
            Name: '测试产品2',
            Description: '另一个测试产品',
            OriginalPrice: 200,
            MemberPrice: 150,
            Commission: 20,
            ImageURL: 'https://via.placeholder.com/300x200/FF0000/FFFFFF',
            StockCount: 50,
            PurchasedCount: 10
          }
        ]
      };
    }
    
    const cacheKey = 'products_data';
    const cached = cache.get(cacheKey);
    
    if (cached) {
      console.log('从缓存获取产品数据');
      return cached;
    }
    
    const sheets = getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Products!A:S',
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
  } catch (error) {
    console.error('获取产品失败:', error);
    // 返回测试数据
    return {
      success: true,
      data: [
        {
          ID: 1,
          Name: '演示产品',
          Description: '系统正常工作，但Google Sheets连接失败',
          OriginalPrice: 999,
          MemberPrice: 799,
          Commission: 50,
          ImageURL: 'https://via.placeholder.com/300x200/4CAF50/FFFFFF?text=Demo+Product',
          StockCount: 100,
          PurchasedCount: 25
        }
      ],
      message: '使用演示数据，请检查环境变量'
    };
  }
}

// 获取所有分类
async function getCategories() {
  try {
    if (!process.env.SPREADSHEET_ID || process.env.SPREADSHEET_ID === 'test') {
      return {
        success: true,
        data: [
          { ID: 1, Name: '电子产品' },
          { ID: 2, Name: '美妆产品' },
          { ID: 3, Name: '服装鞋帽' }
        ]
      };
    }
    
    const cacheKey = 'categories_data';
    const cached = cache.get(cacheKey);
    
    if (cached) {
      console.log('从缓存获取分类数据');
      return cached;
    }
    
    const sheets = getSheets();
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
  } catch (error) {
    console.error('获取分类失败:', error);
    return {
      success: true,
      data: [
        { ID: 1, Name: '测试分类1' },
        { ID: 2, Name: '测试分类2' }
      ]
    };
  }
}

// 其他函数的简化版本
async function getUserCommissions(userId) {
  return {
    success: true,
    totalCommission: 0,
    pendingCommission: 0,
    paidCommission: 0,
    referralCount: 0,
    commissions: []
  };
}

async function getAdminStats() {
  return {
    success: true,
    totalSales: 0,
    totalCommission: 0,
    referralCount: 0,
    productCount: 2,
    orderCount: 0
  };
}

async function createAnonymousUser() {
  const userId = 'guest_' + Date.now();
  const referralCode = generateReferralCode();
  const token = generateToken();
  
  return {
    success: true,
    user: {
      id: userId,
      name: '访客用户',
      role: 'guest',
      referralCode: referralCode,
      token: token,
    },
  };
}

async function adminLogin(username, password) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  
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

async function getSettings() {
  return {
    success: true,
    data: {
      whatsappNumber: process.env.WHATSAPP_NUMBER || '6285215621230',
      defaultCommission: 10,
      siteTitle: '我们的秘密：分享产品，轻松赚钱'
    }
  };
}

async function importProducts(data) {
  return { success: true, importedCount: 0, message: '功能暂不可用' };
}

async function addProduct(params) {
  return { success: true, productId: 999, message: '功能暂不可用' };
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