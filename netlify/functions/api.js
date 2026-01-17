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
