const { google } = require('googleapis');

// ============= 配置区 =============
const SPREADSHEET_ID = '1oPHKFBEMmybpYX3DcbVOt0kIWYXvRyXe6yVv4WlrFQ8';
const SHEET_NAMES = {
    PRODUCTS: 'Products',
    CATEGORIES: 'Categories',
    USERS: 'Users',
    ORDERS: 'Orders',
    COMMISSIONS: 'Commissions',
    LOGS: 'Logs'
};
// =================================

// 通用函数：读取Sheet数据
async function fetchSheetData(sheetName) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY');

    const sheets = google.sheets({ version: 'v4' });
    const range = `${sheetName}!A:Z`;

    try {
        const response = await sheets.spreadsheets.values.get({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        const headers = rows[0];
        const data = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0 || row.every(cell => cell === '')) continue;

            let obj = {};
            headers.forEach((header, index) => {
                if (header) obj[header] = row[index] || '';
            });

            // 类型转换
            if(obj.ID) obj.ID = Number(obj.ID);
            if(obj.OriginalPrice) obj.OriginalPrice = Number(obj.OriginalPrice);
            if(obj.MemberPrice) obj.MemberPrice = Number(obj.MemberPrice);
            if(obj.Commission) obj.Commission = Number(obj.Commission);
            if(obj.StockCount) obj.StockCount = Number(obj.StockCount);
            if(obj.PurchasedCount) obj.PurchasedCount = Number(obj.PurchasedCount);
            
            // 布尔值处理
            const boolFields = ['IsMemberExclusive', 'IsHotSale', 'IsVisible', 'HasCommission'];
            boolFields.forEach(field => {
                if (obj[field] === 'TRUE') obj[field] = true;
                if (obj[field] === 'FALSE') obj[field] = false;
            });

            data.push(obj);
        }
        return data;

    } catch (error) {
        console.error(`Error reading sheet ${sheetName}:`, error.message);
        return null;
    }
}

// 写入Sheet数据
async function writeToSheet(sheetName, data) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const sheets = google.sheets({ version: 'v4' });

    try {
        // 先获取最后一行
        const lastRowResponse = await sheets.spreadsheets.values.get({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:A`,
        });

        const lastRow = lastRowResponse.data.values ? lastRowResponse.data.values.length + 1 : 2;
        
        const response = await sheets.spreadsheets.values.update({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A${lastRow}`,
            valueInputOption: 'RAW',
            resource: { values: [data] }
        });

        return { success: true, row: lastRow };
    } catch (error) {
        console.error(`Error writing to sheet ${sheetName}:`, error.message);
        return { success: false, error: error.message };
    }
}

// 更新Sheet单元格
async function updateSheetCell(sheetName, cell, value) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const sheets = google.sheets({ version: 'v4' });

    try {
        const response = await sheets.spreadsheets.values.update({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!${cell}`,
            valueInputOption: 'RAW',
            resource: { values: [[value]] }
        });

        return { success: true };
    } catch (error) {
        console.error(`Error updating sheet ${sheetName}:`, error.message);
        return { success: false, error: error.message };
    }
}

// Netlify Function 主入口
exports.handler = async (event) => {
    // CORS 设置
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    const body = JSON.parse(event.body || '{}');
    const params = event.queryStringParameters || {};
    const action = body.action || params.action;

    let responseData = { success: false, message: 'Invalid action' };

    try {
        switch (action) {
            // 1. 获取可见产品列表
            case 'getProducts':
                const products = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                if (products) {
                    // 过滤只显示 IsVisible = TRUE 的产品
                    const visibleProducts = products.filter(p => p.IsVisible !== false);
                    responseData = { success: true, data: visibleProducts };
                } else {
                    responseData = { success: false, message: 'Failed to load products' };
                }
                break;

            // 2. 获取分类列表
            case 'getCategories':
                const categories = await fetchSheetData(SHEET_NAMES.CATEGORIES);
                responseData = categories ? 
                    { success: true, data: categories } : 
                    { success: false, message: 'Failed to load categories' };
                break;

            // 3. 获取单个产品
            case 'getProduct':
                const allProducts = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                const productId = body.id || params.id;
                if (allProducts && productId) {
                    const product = allProducts.find(p => p.ID == productId && p.IsVisible !== false);
                    responseData = product ? { success: true, data: product } : { success: false, message: 'Product not found' };
                }
                break;

            // 4. 验证用户登录
            case 'verifyLogin':
                const whatsapp = body.whatsapp || params.whatsapp;
                const password = body.password || params.password;
                
                if (!whatsapp || !password) {
                    responseData = { success: false, message: 'Missing WhatsApp or password' };
                    break;
                }

                const users = await fetchSheetData(SHEET_NAMES.USERS);
                if (users) {
                    const user = users.find(u => u.Phone == whatsapp);
                    
                    if (!user) {
                        responseData = { success: false, message: 'User not found' };
                    } else if (!user.Password || user.Password !== password) {
                        responseData = { success: false, message: 'Incorrect password or no commission yet' };
                    } else if (user.HasCommission !== true) {
                        responseData = { success: false, message: 'No commission available' };
                    } else {
                        // 登录成功，返回用户信息和佣金数据
                        const commissions = await fetchSheetData(SHEET_NAMES.COMMISSIONS);
                        const userCommissions = commissions ? commissions.filter(c => c.UserID == user.ID) : [];
                        
                        responseData = {
                            success: true,
                            user: {
                                id: user.ID,
                                name: user.Name,
                                phone: user.Phone,
                                hasCommission: user.HasCommission
                            },
                            commissions: userCommissions
                        };
                    }
                } else {
                    responseData = { success: false, message: 'Failed to load users' };
                }
                break;

            // 5. 创建或获取用户
            case 'getOrCreateUser':
                const userWhatsapp = body.whatsapp || params.whatsapp;
                if (!userWhatsapp) {
                    responseData = { success: false, message: 'Missing WhatsApp number' };
                    break;
                }

                const allUsers = await fetchSheetData(SHEET_NAMES.USERS);
                let user = allUsers ? allUsers.find(u => u.Phone == userWhatsapp) : null;

                if (!user) {
                    // 创建新用户
                    const newUser = [
                        (allUsers ? allUsers.length + 1 : 1), // ID
                        userWhatsapp, // Phone
                        '', // Name
                        `REF${Date.now()}`, // ReferralCode
                        '', // Referrer
                        0, // TotalCommission
                        0, // PendingCommission
                        0, // PaidCommission
                        0, // ReferralCount
                        'user', // Role
                        `TOKEN${Date.now()}`, // Token
                        new Date().toISOString(), // CreatedAt
                        '', // Password (空，等待后台人工填写)
                        false, // HasCommission
                        '' // CommissionPasswordSent
                    ];

                    const writeResult = await writeToSheet(SHEET_NAMES.USERS, newUser);
                    if (writeResult.success) {
                        user = {
                            ID: newUser[0],
                            Phone: userWhatsapp,
                            Name: '',
                            HasCommission: false
                        };
                        responseData = { success: true, user: user, isNew: true };
                    } else {
                        responseData = { success: false, message: 'Failed to create user' };
                    }
                } else {
                    responseData = { success: true, user: user, isNew: false };
                }
                break;

            // 6. 获取用户佣金数据
            case 'getUserCommissions':
                const userId = body.userId || params.userId;
                const whatsappNum = body.whatsapp || params.whatsapp;
                
                if (!userId && !whatsappNum) {
                    responseData = { success: false, message: 'Missing user identifier' };
                    break;
                }

                const allCommissions = await fetchSheetData(SHEET_NAMES.COMMISSIONS);
                const allUsersForCommission = await fetchSheetData(SHEET_NAMES.USERS);
                
                let targetUserId = userId;
                if (!targetUserId && whatsappNum) {
                    const targetUser = allUsersForCommission.find(u => u.Phone == whatsappNum);
                    targetUserId = targetUser ? targetUser.ID : null;
                }

                if (allCommissions && targetUserId) {
                    const userCommissions = allCommissions.filter(c => c.UserID == targetUserId);
                    
                    // 计算统计
                    const totalCommission = userCommissions.reduce((sum, c) => sum + (c.Commission || 0), 0);
                    const pendingCommission = userCommissions
                        .filter(c => c.Status === 'pending')
                        .reduce((sum, c) => sum + (c.Commission || 0), 0);
                    const paidCommission = userCommissions
                        .filter(c => c.Status === 'paid')
                        .reduce((sum, c) => sum + (c.Commission || 0), 0);

                    responseData = {
                        success: true,
                        commissions: userCommissions,
                        totalCommission: totalCommission,
                        pendingCommission: pendingCommission,
                        paidCommission: paidCommission,
                        referralCount: userCommissions.length
                    };
                } else {
                    responseData = { success: false, message: 'No commissions found' };
                }
                break;

            // 7. 记录日志
            case 'logActivity':
                const { type, message, deviceId, whatsapp: logWhatsapp } = body;
                const logEntry = [
                    new Date().toISOString(), // Timestamp
                    type || 'info', // Type
                    message || '', // Message
                    deviceId || '', // DeviceID
                    logWhatsapp || '', // WhatsApp
                    JSON.stringify(body.data || {}) // Data
                ];

                const logResult = await writeToSheet(SHEET_NAMES.LOGS, logEntry);
                responseData = logResult.success ? 
                    { success: true } : 
                    { success: false, message: 'Failed to log activity' };
                break;

            // 8. 获取管理员数据
            case 'getAdminStats':
                const [adminProducts, adminUsers, adminOrders, adminCommissions] = await Promise.all([
                    fetchSheetData(SHEET_NAMES.PRODUCTS),
                    fetchSheetData(SHEET_NAMES.USERS),
                    fetchSheetData(SHEET_NAMES.ORDERS),
                    fetchSheetData(SHEET_NAMES.COMMISSIONS)
                ]);

                const totalSales = adminOrders ? adminOrders.reduce((sum, o) => sum + (o.Amount || 0), 0) : 0;
                const totalCommission = adminCommissions ? adminCommissions.reduce((sum, c) => sum + (c.Commission || 0), 0) : 0;
                const userCount = adminUsers ? adminUsers.length : 0;
                const orderCount = adminOrders ? adminOrders.length : 0;

                responseData = {
                    success: true,
                    totalSales: totalSales,
                    totalCommission: totalCommission,
                    userCount: userCount,
                    orderCount: orderCount,
                    commissions: adminCommissions || []
                };
                break;

            default:
                responseData = { success: false, message: 'Unknown action: ' + action };
        }
    } catch (error) {
        console.error('Handler Error:', error);
        responseData = { success: false, message: 'Server error', error: error.message };
    }

    return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(responseData)
    };
};
// 在现有代码中添加以下部分：

// ============= 新增：产品数据统计功能 =============

// 1. 在SHEET_NAMES中添加新的表格
const SHEET_NAMES = {
    PRODUCTS: 'Products',
    CATEGORIES: 'Categories',
    USERS: 'Users',
    ORDERS: 'Orders',
    COMMISSIONS: 'Commissions',
    LOGS: 'Logs',
    PRODUCT_STATS: 'ProductStats'  // 新增：产品统计数据表
};

// 2. 新增函数：记录产品统计
async function recordProductStat(productId, statType, additionalData = {}) {
    try {
        const timestamp = new Date().toISOString();
        const deviceId = additionalData.deviceId || '';
        const whatsapp = additionalData.whatsapp || '';
        
        const statData = [
            timestamp,          // Timestamp
            productId,          // ProductID
            statType,           // StatType: view, click, share, like, purchase
            deviceId,           // DeviceID
            whatsapp,           // WhatsApp
            JSON.stringify(additionalData)  // AdditionalData
        ];
        
        const result = await writeToSheet(SHEET_NAMES.PRODUCT_STATS, statData);
        return result.success;
    } catch (error) {
        console.error('Error recording product stat:', error);
        return false;
    }
}

// 3. 新增函数：获取产品统计数据
async function getProductStats(productId = null, startDate = null, endDate = null) {
    try {
        const stats = await fetchSheetData(SHEET_NAMES.PRODUCT_STATS);
        if (!stats) return null;
        
        // 过滤数据
        let filteredStats = stats;
        if (productId) {
            filteredStats = filteredStats.filter(stat => stat.ProductID == productId);
        }
        if (startDate) {
            const start = new Date(startDate);
            filteredStats = filteredStats.filter(stat => new Date(stat.Timestamp) >= start);
        }
        if (endDate) {
            const end = new Date(endDate);
            filteredStats = filteredStats.filter(stat => new Date(stat.Timestamp) <= end);
        }
        
        // 按产品分组统计
        const productStats = {};
        filteredStats.forEach(stat => {
            const pid = stat.ProductID;
            if (!productStats[pid]) {
                productStats[pid] = {
                    productId: pid,
                    views: 0,
                    clicks: 0,
                    shares: 0,
                    likes: 0,
                    purchases: 0,
                    timeline: []
                };
            }
            
            // 统计不同类型
            switch(stat.StatType) {
                case 'view':
                    productStats[pid].views++;
                    break;
                case 'click':
                    productStats[pid].clicks++;
                    break;
                case 'share':
                    productStats[pid].shares++;
                    break;
                case 'like':
                    productStats[pid].likes++;
                    break;
                case 'purchase':
                    productStats[pid].purchases++;
                    break;
            }
            
            // 添加时间线数据
            productStats[pid].timeline.push({
                timestamp: stat.Timestamp,
                type: stat.StatType,
                deviceId: stat.DeviceID,
                whatsapp: stat.WhatsApp
            });
        });
        
        // 获取产品信息
        const products = await fetchSheetData(SHEET_NAMES.PRODUCTS);
        if (products) {
            Object.keys(productStats).forEach(pid => {
                const product = products.find(p => p.ID == pid);
                if (product) {
                    productStats[pid].productName = product.Name;
                    productStats[pid].categoryId = product.CategoryID;
                    productStats[pid].price = product.MemberPrice;
                    productStats[pid].commission = product.Commission;
                }
            });
        }
        
        return productStats;
        
    } catch (error) {
        console.error('Error getting product stats:', error);
        return null;
    }
}

// 4. 新增函数：获取统计汇总数据
async function getStatsSummary(timeRange = '7d') {
    try {
        // 计算日期范围
        const endDate = new Date();
        const startDate = new Date();
        
        switch(timeRange) {
            case '1d':
                startDate.setDate(startDate.getDate() - 1);
                break;
            case '7d':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(startDate.getDate() - 30);
                break;
            default:
                startDate.setDate(startDate.getDate() - 7);
        }
        
        const stats = await getProductStats(null, startDate.toISOString(), endDate.toISOString());
        if (!stats) return null;
        
        // 计算总计
        let totalViews = 0;
        let totalClicks = 0;
        let totalShares = 0;
        let totalLikes = 0;
        let totalPurchases = 0;
        let totalProducts = Object.keys(stats).length;
        
        Object.values(stats).forEach(stat => {
            totalViews += stat.views;
            totalClicks += stat.clicks;
            totalShares += stat.shares;
            totalLikes += stat.likes;
            totalPurchases += stat.purchases;
        });
        
        // 计算转化率
        const clickToViewRate = totalViews > 0 ? (totalClicks / totalViews * 100).toFixed(2) : 0;
        const shareToClickRate = totalClicks > 0 ? (totalShares / totalClicks * 100).toFixed(2) : 0;
        const purchaseToShareRate = totalShares > 0 ? (totalPurchases / totalShares * 100).toFixed(2) : 0;
        
        return {
            summary: {
                totalViews,
                totalClicks,
                totalShares,
                totalLikes,
                totalPurchases,
                totalProducts
            },
            rates: {
                clickToViewRate,
                shareToClickRate,
                purchaseToShareRate
            },
            dailyStats: await getDailyStats(startDate, endDate),
            productStats: stats
        };
        
    } catch (error) {
        console.error('Error getting stats summary:', error);
        return null;
    }
}

// 5. 新增函数：获取每日统计数据
async function getDailyStats(startDate, endDate) {
    try {
        const stats = await fetchSheetData(SHEET_NAMES.PRODUCT_STATS);
        if (!stats) return [];
        
        // 过滤日期范围
        const filteredStats = stats.filter(stat => {
            const statDate = new Date(stat.Timestamp);
            return statDate >= startDate && statDate <= endDate;
        });
        
        // 按日期分组
        const dailyData = {};
        filteredStats.forEach(stat => {
            const date = stat.Timestamp.split('T')[0]; // 获取YYYY-MM-DD
            
            if (!dailyData[date]) {
                dailyData[date] = {
                    views: 0,
                    clicks: 0,
                    shares: 0,
                    likes: 0,
                    purchases: 0
                };
            }
            
            switch(stat.StatType) {
                case 'view':
                    dailyData[date].views++;
                    break;
                case 'click':
                    dailyData[date].clicks++;
                    break;
                case 'share':
                    dailyData[date].shares++;
                    break;
                case 'like':
                    dailyData[date].likes++;
                    break;
                case 'purchase':
                    dailyData[date].purchases++;
                    break;
            }
        });
        
        // 转换为数组并按日期排序
        return Object.keys(dailyData)
            .map(date => ({
                date,
                ...dailyData[date]
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
        
    } catch (error) {
        console.error('Error getting daily stats:', error);
        return [];
    }
}

// ============= 修改主入口函数 =============
// 在现有的exports.handler中添加以下case：

exports.handler = async (event) => {
    // ... 现有代码保持不变 ...
    
    try {
        switch (action) {
            // ... 现有case保持不变 ...
            
            // 新增：记录产品统计
            case 'recordProductStat':
                const { productId, statType, deviceId, whatsapp } = body;
                if (!productId || !statType) {
                    responseData = { success: false, message: 'Missing required parameters' };
                    break;
                }
                
                const result = await recordProductStat(productId, statType, {
                    deviceId: deviceId || '',
                    whatsapp: whatsapp || '',
                    userAgent: event.headers['user-agent'],
                    ip: event.headers['client-ip']
                });
                
                responseData = { success: result };
                break;
            
            // 新增：获取产品统计数据
            case 'getProductStats':
                const { productId: statsProductId, startDate, endDate } = body;
                const stats = await getProductStats(statsProductId, startDate, endDate);
                responseData = stats ? 
                    { success: true, data: stats } : 
                    { success: false, message: 'Failed to load product stats' };
                break;
            
            // 新增：获取统计汇总
            case 'getStatsSummary':
                const { timeRange } = body;
                const summary = await getStatsSummary(timeRange || '7d');
                responseData = summary ? 
                    { success: true, data: summary } : 
                    { success: false, message: 'Failed to load stats summary' };
                break;
            
            // 新增：获取单个产品详细统计
            case 'getProductDetailStats':
                const { productId: detailProductId } = body;
                if (!detailProductId) {
                    responseData = { success: false, message: 'Missing productId' };
                    break;
                }
                
                const detailStats = await getProductStats(detailProductId);
                const productsData = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                const productInfo = productsData ? productsData.find(p => p.ID == detailProductId) : null;
                
                if (detailStats && productInfo) {
                    responseData = {
                        success: true,
                        data: {
                            productInfo: productInfo,
                            stats: detailStats[detailProductId] || {
                                views: 0,
                                clicks: 0,
                                shares: 0,
                                likes: 0,
                                purchases: 0,
                                timeline: []
                            }
                        }
                    };
                } else {
                    responseData = { success: false, message: 'Product not found' };
                }
                break;
            
            // ... 现有代码继续 ...
        }
    } catch (error) {
        // ... 错误处理 ...
    }
    
    return response;
};
