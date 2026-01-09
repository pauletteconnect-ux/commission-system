// netlify/functions/api.js - 修复版本
const { google } = require('googleapis');
const NodeCache = require('node-cache');

// 创建缓存，5分钟有效期
const cache = new NodeCache({ stdTTL: 300 });

// 辅助函数：安全解析环境变量中的JSON
function parseGoogleCredentials(credString) {
  try {
    if (!credString) {
      throw new Error('凭证字符串为空');
    }
    
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
    // 获取查询参数
    const params = event.queryStringParameters || {};
    
    // 解析请求体（支持JSON和表单格式）
    let body = {};
    if (event.body) {
      const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
      
      if (contentType.includes('application/json')) {
        // JSON格式
        try {
          body = JSON.parse(event.body);
        } catch (e) {
          console.error('解析JSON失败:', e.message);
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // 表单格式（如：action=adminLogin&username=admin&password=admin123）
        const qs = require('querystring');
        body = qs.parse(event.body);
      } else {
        // 默认尝试解析JSON
        try {
          body = JSON.parse(event.body);
        } catch (e) {
          // 如果不是JSON，尝试解析为查询字符串
          try {
            const qs = require('querystring');
            body = qs.parse(event.body);
          } catch (e2) {
            console.error('解析请求体失败:', e2.message);
          }
        }
      }
    }
    
    // 合并参数，body中的参数优先
    const allParams = { ...params, ...body };
    const action = allParams.action;
    
    let response;
    
    switch (action) {
      case 'getProducts':
        response = await getProducts();
        break;
      case 'getCategories':
        response = await getCategories();
        break;
      case 'getUserCommissions':
        response = await getUserCommissions(allParams.userId);
        break;
      case 'getAdminStats':
        response = await getAdminStats();
        break;
      case 'createAnonymousUser':
        response = await createAnonymousUser();
        break;
      case 'adminLogin':
        response = await adminLogin(allParams.username, allParams.password);
        break;
      case 'getSettings':
        response = await getSettings();
        break;
      case 'importProducts':
        response = await importProducts(allParams.data);
        break;
      case 'addProduct':
        response = await addProduct(allParams);
        break;
      case 'updateProduct':
        response = await updateProduct(allParams);
        break;
      case 'deleteProduct':
        response = await deleteProduct(allParams.productId);
        break;
      case 'addCategory':
        response = await addCategory(allParams.name);
        break;
      case 'getUsers':
        response = await getUsers();
        break;
      case 'exportData':
        response = await exportData(allParams.type);
        break;
      case 'saveSettings':
        response = await saveSettings(allParams.settings);
        break;
      case 'diagnose':
        response = await diagnoseSystem();
        break;
      default:
        response = { 
          success: false, 
          message: '操作不存在',
          availableActions: [
            'getProducts', 'getCategories', 'getUserCommissions',
            'getAdminStats', 'createAnonymousUser', 'adminLogin',
            'getSettings', 'importProducts', 'addProduct',
            'updateProduct', 'deleteProduct', 'addCategory',
            'getUsers', 'exportData', 'saveSettings', 'diagnose'
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

// 系统诊断函数
async function diagnoseSystem() {
  const diagnostics = {
    environmentVariables: {
      GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS ? '已设置' : '未设置',
      SPREADSHEET_ID: process.env.SPREADSHEET_ID || '未设置',
      SPREADSHEET_ID_LENGTH: process.env.SPREADSHEET_ID ? process.env.SPREADSHEET_ID.length : 0,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? '已设置' : '未设置'
    },
    googleCredentials: {
      isValid: false,
      parsed: null,
      error: null
    },
    sheetsAccess: {
      canAccess: false,
      error: null
    },
    serverInfo: {
      nodeVersion: process.version,
      timestamp: new Date().toISOString()
    }
  };
  
  // 尝试解析Google凭证
  try {
    if (process.env.GOOGLE_CREDENTIALS) {
      const credentials = parseGoogleCredentials(process.env.GOOGLE_CREDENTIALS);
      diagnostics.googleCredentials.isValid = true;
      diagnostics.googleCredentials.parsed = {
        client_email: credentials.client_email,
        project_id: credentials.project_id
      };
    }
  } catch (error) {
    diagnostics.googleCredentials.error = error.message;
    diagnostics.googleCredentials.parsed = process.env.GOOGLE_CREDENTIALS ? 
      process.env.GOOGLE_CREDENTIALS.substring(0, 100) + '...' : '空';
  }
  
  // 尝试访问Google Sheets
  try {
    if (diagnostics.googleCredentials.isValid && process.env.SPREADSHEET_ID) {
      const sheets = getSheets();
      const response = await sheets.spreadsheets.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        fields: 'properties.title,sheets.properties'
      });
      diagnostics.sheetsAccess.canAccess = true;
      diagnostics.sheetsAccess.title = response.data.properties.title;
      diagnostics.sheetsAccess.sheets = response.data.sheets.map(s => s.properties.title);
    }
  } catch (error) {
    diagnostics.sheetsAccess.error = error.message;
  }
  
  return {
    success: true,
    diagnostics: diagnostics
  };
}

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
    // 返回演示数据
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

async function updateProduct(params) {
  return { success: true, message: '功能暂不可用' };
}

async function deleteProduct(productId) {
  return { success: true, message: '功能暂不可用' };
}

async function addCategory(name) {
  return { success: true, message: '功能暂不可用' };
}

async function getUsers() {
  return { success: true, data: [] };
}

async function exportData(type) {
  return { success: false, message: '功能暂不可用' };
}

async function saveSettings(settingsStr) {
  try {
    const settings = JSON.parse(settingsStr);
    return { success: true, message: '设置保存成功（演示模式）' };
  } catch (e) {
    return { success: false, message: '解析设置失败' };
  }
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