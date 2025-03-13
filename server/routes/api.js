const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');

// Helper function to handle errors consistently
const handleError = (error, res, ticker) => {
  console.error(`Error fetching data for ${ticker}:`, error);
  
  // Determine if it's a scraping error or another type
  const isScrapingError = error.message.includes('Failed to parse') || 
                          error.message.includes('Failed to fetch');
  
  const status = error.response?.status || (isScrapingError ? 503 : 500);
  const message = isScrapingError
    ? `Unable to retrieve data for ${ticker}. This could be due to temporary service issues or changes in the website structure.`
    : error.message || 'Internal Server Error';
  
  res.status(status).json({
    success: false,
    error: {
      message,
      status,
      originalError: error.message
    }
  });
};

// Helper function to fetch and parse HTML
async function fetchHtml(url) {
  try {
    // Use a more modern and varied User-Agent to avoid being blocked
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36 Edg/96.0.1054.62',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:95.0) Gecko/20100101 Firefox/95.0'
    ];
    
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': randomUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://stockanalysis.com/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1'
      },
      timeout: 15000, // Increased timeout to 15 seconds
      maxRedirects: 5
    });
    
    // Check if we got a valid HTML response
    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Unexpected content type: ${contentType}`);
    }
    
    return cheerio.load(response.data);
  } catch (error) {
    console.error(`Error fetching URL ${url}:`, error.message);
    
    if (error.response) {
      throw new Error(`Failed to fetch data from ${url}: HTTP ${error.response.status}`);
    } else if (error.request) {
      throw new Error(`Failed to fetch data from ${url}: No response received. The service might be temporarily unavailable.`);
    } else {
      throw new Error(`Failed to fetch data from ${url}: ${error.message}`);
    }
  }
}

// Helper function to extract numeric value from text
function extractNumber(text) {
  if (!text) return null;
  
  // Remove any non-numeric characters except for decimal points and negative signs
  const numericText = text.replace(/[^0-9.-]/g, '');
  const parsedNumber = parseFloat(numericText);
  
  return isNaN(parsedNumber) ? null : parsedNumber;
}

// Helper function to format numbers with commas and units
function formatNumberWithCommas(number) {
  if (number === null || isNaN(number)) return 'N/A';
  
  // Handle millions (m) and billions (b)
  let suffix = '';
  if (Math.abs(number) >= 1e9) {
    number = number / 1e9;
    suffix = 'b';
  } else if (Math.abs(number) >= 1e6) {
    number = number / 1e6;
    suffix = 'm';
  }
  
  // Format with commas and up to 2 decimal places
  return number.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }) + suffix;
}

// Get free cash flow from cash flow statement
async function getFreeCashFlow(ticker) {
  const url = `https://stockanalysis.com/stocks/${ticker}/financials/cash-flow-statement/`;
  const $ = await fetchHtml(url);
  
  // Look for the Free Cash Flow row in the table
  let freeCashFlow = null;
  
  // First attempt: Look for exact "Free Cash Flow" text with updated selectors
  // Try different table selectors to accommodate website structure changes
  $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
    const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim();
    if (rowLabel === 'Free Cash Flow') {
      // Get the most recent value (first data column)
      const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
      freeCashFlow = extractNumber(valueText);
      return false; // Break the loop
    }
  });
  
  // Second attempt: Look for case-insensitive match if first attempt failed
  if (freeCashFlow === null) {
    $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
      const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim().toLowerCase();
      if (rowLabel.includes('free cash flow')) {
        const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
        freeCashFlow = extractNumber(valueText);
        return false; // Break the loop
      }
    });
  }
  
  // If still not found, try calculating it (Operating Cash Flow - Capital Expenditures)
  if (freeCashFlow === null) {
    let operatingCashFlow = null;
    let capitalExpenditures = null;
    
    $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
      const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim().toLowerCase();
      const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
      
      if (rowLabel.includes('operating cash flow') || rowLabel.includes('cash from operations') || rowLabel.includes('net cash provided by operating activities')) {
        operatingCashFlow = extractNumber(valueText);
      } else if (rowLabel.includes('capital expenditure') || rowLabel.includes('capex') || rowLabel.includes('purchases of property and equipment')) {
        capitalExpenditures = extractNumber(valueText);
      }
    });
    
    if (operatingCashFlow !== null && capitalExpenditures !== null) {
      freeCashFlow = operatingCashFlow - Math.abs(capitalExpenditures);
    }
  }
  
  if (freeCashFlow === null) {
    throw new Error(`Failed to parse Free Cash Flow data for ${ticker}`);
  }
  
  return {
    value: freeCashFlow,
    formattedValue: formatNumberWithCommas(freeCashFlow),
    sourceUrl: url
  };
}

// Get balance sheet data (cash and debt)
async function getBalanceSheetData(ticker) {
  const url = `https://stockanalysis.com/stocks/${ticker}/financials/balance-sheet/?p=trailing`;
  const $ = await fetchHtml(url);
  
  let cashAndEquivalents = null;
  let totalDebt = null;
  
  // Look for cash and cash equivalents with updated selectors
  $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
    const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim().toLowerCase();
    const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
    
    if (rowLabel.includes('cash and cash equivalents') || rowLabel === 'cash and equivalents' || rowLabel === 'cash & equivalents') {
      cashAndEquivalents = extractNumber(valueText);
    } else if (rowLabel.includes('total debt')) {
      totalDebt = extractNumber(valueText);
    }
  });
  
  // If cash not found, try alternative labels
  if (cashAndEquivalents === null) {
    $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
      const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim().toLowerCase();
      if (rowLabel.includes('cash') && !rowLabel.includes('flow')) {
        const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
        cashAndEquivalents = extractNumber(valueText);
        return false;
      }
    });
  }
  
  // If debt not found, try alternative calculations (Long-term debt + Short-term debt)
  if (totalDebt === null) {
    let longTermDebt = null;
    let shortTermDebt = null;
    
    $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
      const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim().toLowerCase();
      const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
      
      if (rowLabel.includes('long-term debt') || rowLabel.includes('long term debt')) {
        longTermDebt = extractNumber(valueText);
      } else if (rowLabel.includes('short-term debt') || rowLabel.includes('short term debt') || rowLabel.includes('current portion of long-term debt')) {
        shortTermDebt = extractNumber(valueText);
      }
    });
    
    if (longTermDebt !== null) {
      totalDebt = longTermDebt;
      if (shortTermDebt !== null) {
        totalDebt += shortTermDebt;
      }
    }
  }
  
  if (cashAndEquivalents === null) {
    throw new Error(`Failed to parse Cash and Equivalents data for ${ticker}`);
  }
  
  if (totalDebt === null) {
    throw new Error(`Failed to parse Total Debt data for ${ticker}`);
  }
  
  return {
    cashAndEquivalents,
    formattedCashAndEquivalents: formatNumberWithCommas(cashAndEquivalents),
    totalDebt,
    formattedTotalDebt: formatNumberWithCommas(totalDebt),
    sourceUrl: url
  };
}

// Get shares outstanding
async function getSharesOutstanding(ticker) {
  const url = `https://stockanalysis.com/stocks/${ticker}/financials/`;
  const $ = await fetchHtml(url);
  
  let sharesOutstanding = null;
  
  // Look for shares outstanding (diluted) with updated selectors
  $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
    const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim().toLowerCase();
    
    if (rowLabel.includes('shares outstanding (diluted)') || 
        rowLabel.includes('diluted shares outstanding') || 
        rowLabel.includes('weighted average shares diluted')) {
      const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
      sharesOutstanding = extractNumber(valueText);
      return false;
    }
  });
  
  // If diluted not found, try basic shares outstanding
  if (sharesOutstanding === null) {
    $('table tr, .table-row, [data-test="table-row"]').each((i, row) => {
      const rowLabel = $(row).find('td:first-child, th:first-child, [data-test="table-cell"]:first-child, .table-cell:first-child').text().trim().toLowerCase();
      
      if (rowLabel.includes('shares outstanding') || rowLabel.includes('common shares outstanding')) {
        const valueText = $(row).find('td:nth-child(2), th:nth-child(2), [data-test="table-cell"]:nth-child(2), .table-cell:nth-child(2)').text().trim();
        sharesOutstanding = extractNumber(valueText);
        return false;
      }
    });
  }
  
  // Try to find shares outstanding in any table cell that contains the word "shares"
  if (sharesOutstanding === null) {
    $('table td, table th, [data-test="table-cell"], .table-cell').each((i, cell) => {
      const cellText = $(cell).text().trim().toLowerCase();
      if (cellText.includes('shares') && cellText.includes('outstanding') && !cellText.includes('treasury')) {
        // Look for a number in this cell or the next cell
        const valueText = $(cell).next().text().trim() || cellText;
        const possibleValue = extractNumber(valueText);
        if (possibleValue !== null && possibleValue > 1000000) { // Likely a valid shares count (in millions)
          sharesOutstanding = possibleValue;
          return false;
        }
      }
    });
  }
  
  if (sharesOutstanding === null) {
    throw new Error(`Failed to parse Shares Outstanding data for ${ticker}`);
  }
  
  return {
    value: sharesOutstanding,
    formattedValue: formatNumberWithCommas(sharesOutstanding),
    sourceUrl: url
  };
}

// Get current stock price
async function getCurrentPrice(ticker) {
  try {
    // Use Yahoo Finance API
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await axios.get(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (response.data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
      const price = response.data.chart.result[0].meta.regularMarketPrice;
      return {
        value: price,
        formattedValue: formatNumberWithCommas(price),
        sourceUrl: `https://finance.yahoo.com/quote/${ticker}`
      };
    }

    // Fallback to previous method if Yahoo Finance API fails
    const url = `https://stockanalysis.com/stocks/${ticker}/`;
    const $ = await fetchHtml(url);
    
    let currentPrice = null;
    
    // Try to find the price with more specific selectors
    const priceSelectors = [
      '[data-test="price-value"]',
      '[data-test="symbol-price"]',
      '.symbol-price',
      '.price-value',
      '[data-test="instrument-price-last"]'
    ];
    
    for (const selector of priceSelectors) {
      const element = $(selector);
      if (element.length) {
        const text = element.text().trim();
        const price = extractNumber(text);
        if (price !== null && price > 0) {
          currentPrice = price;
          break;
        }
      }
    }
    
    if (currentPrice === null) {
      throw new Error(`Failed to parse Current Price data for ${ticker}`);
    }
    
    return {
      value: currentPrice,
      formattedValue: formatNumberWithCommas(currentPrice),
      sourceUrl: url
    };
  } catch (error) {
    console.error('Error fetching stock price:', error);
    throw new Error(`Failed to fetch current price for ${ticker}: ${error.message}`);
  }
}

// Get company name
async function getCompanyName(ticker) {
  const url = `https://stockanalysis.com/stocks/${ticker}/`;
  const $ = await fetchHtml(url);
  
  let companyName = null;
  
  // Try to find company name in title or header with updated selectors
  const title = $('title').text();
  if (title) {
    const titleParts = title.split('|');
    if (titleParts.length > 1) {
      companyName = titleParts[0].trim();
    }
  }
  
  // If not found in title, try header elements with updated selectors
  if (!companyName) {
    // Try different selectors for company name
    companyName = $('[data-test="instrument-header-name"], .company-name, h1').text().trim();
    
    // Remove ticker from company name if present
    companyName = companyName.replace(new RegExp(`\\(${ticker}\\)`, 'i'), '').trim();
  }
  
  // If still not found, try to find any prominent text that might be the company name
  if (!companyName) {
    $('h1, h2, .header-text, [data-test*="header"]').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 100 && !text.includes('http') && !text.includes('www')) {
        // Remove ticker if present
        const cleanText = text.replace(new RegExp(`\\(${ticker}\\)`, 'i'), '').trim();
        if (cleanText) {
          companyName = cleanText;
          return false; // Break the loop
        }
      }
    });
  }
  
  if (!companyName) {
    throw new Error(`Failed to parse Company Name for ${ticker}`);
  }
  
  return companyName;
}

// Helper function to detect currency from financial statements
async function detectReportingCurrency(ticker) {
  const url = `https://stockanalysis.com/stocks/${ticker}/financials/`;
  const $ = await fetchHtml(url);
  
  let currency = 'USD'; // Default currency
  
  // First try to find explicit currency mention in the header or financial notes
  const headerText = $('h1, .financials-header, .table-header').text().toLowerCase();
  const pageText = $('body').text().toLowerCase();
  
  // Look for common currency formats in financial statements
  const currencyPatterns = {
    'TWD': ['millions twd', 'twd millions', 'million twd', 'ntd', 'new taiwan dollar', 'taiwan dollar'],
    'CNY': ['millions cny', 'cny millions', 'million cny', 'rmb', 'yuan', 'chinese yuan'],
    'JPY': ['millions jpy', 'jpy millions', 'million jpy', 'yen', 'japanese yen'],
    'EUR': ['millions eur', 'eur millions', 'million eur', '€', 'euro'],
    'GBP': ['millions gbp', 'gbp millions', 'million gbp', '£', 'british pound'],
    'HKD': ['millions hkd', 'hkd millions', 'million hkd', 'hong kong dollar']
  };
  
  // First check the header text for currency information
  for (const [curr, patterns] of Object.entries(currencyPatterns)) {
    if (patterns.some(pattern => headerText.includes(pattern))) {
      currency = curr;
      break;
    }
  }
  
  // If not found in header, check the entire page
  if (currency === 'USD') {
    for (const [curr, patterns] of Object.entries(currencyPatterns)) {
      if (patterns.some(pattern => pageText.includes(pattern))) {
        currency = curr;
        break;
      }
    }
  }
  
  // Also look for "Financials in millions X" pattern
  const currencyMatch = pageText.match(/financials in millions ([a-z]{3})/i);
  if (currencyMatch && currencyMatch[1]) {
    const detectedCurrency = currencyMatch[1].toUpperCase();
    if (Object.keys(currencyPatterns).includes(detectedCurrency)) {
      currency = detectedCurrency;
    }
  }
  
  return currency;
}

// Helper function to get exchange rate
async function getExchangeRate(fromCurrency) {
  // If the currency is USD, return a structured response matching the non-USD case
  if (fromCurrency === 'USD') {
    return {
      rate: 1,
      timestamp: new Date().toISOString(),
      fromCurrency: 'USD',
      toCurrency: 'USD'
    };
  }
  
  try {
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/USD`);
    const rates = response.data.rates;
    const rate = 1 / rates[fromCurrency]; // Convert to USD
    
    return {
      rate: rate,
      timestamp: new Date().toISOString(),
      fromCurrency: fromCurrency,
      toCurrency: 'USD'
    };
  } catch (error) {
    console.error(`Error fetching exchange rate for ${fromCurrency}:`, error);
    // Return a default rate of 1 with an error flag if exchange rate fetch fails
    return {
      rate: 1,
      timestamp: new Date().toISOString(),
      fromCurrency: fromCurrency,
      toCurrency: 'USD',
      error: true
    };
  }
}

// Main API endpoint to get all stock data
router.get('/stock/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  
  try {
    // Validate ticker format
    if (!/^[A-Z]{1,5}$/.test(ticker)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid ticker format. Please provide a valid stock ticker symbol.',
          status: 400
        }
      });
    }
    
    // Detect currency first
    const reportingCurrency = await detectReportingCurrency(ticker);
    const exchangeRate = await getExchangeRate(reportingCurrency);
    
    // Fetch all data in parallel
    const [
      companyName,
      currentPriceData,
      freeCashFlowData,
      balanceSheetData,
      sharesOutstandingData
    ] = await Promise.all([
      getCompanyName(ticker),
      getCurrentPrice(ticker),
      getFreeCashFlow(ticker),
      getBalanceSheetData(ticker),
      getSharesOutstanding(ticker)
    ]);
    
    // Convert values to USD if necessary
    const convertToUSD = (value) => value * exchangeRate.rate;
    
    // Compile all data with both original currency and USD values
    const stockData = {
      companyName,
      ticker,
      reportingCurrency,
      exchangeRate: exchangeRate.rate,
      currentPrice: currentPriceData.value,
      formattedCurrentPrice: currentPriceData.formattedValue,
      freeCashFlow: freeCashFlowData.value,
      freeCashFlowUSD: convertToUSD(freeCashFlowData.value),
      formattedFreeCashFlow: `${formatNumberWithCommas(freeCashFlowData.value)} ${reportingCurrency}`,
      formattedFreeCashFlowUSD: `$${formatNumberWithCommas(convertToUSD(freeCashFlowData.value))}`,
      cashAndEquivalents: balanceSheetData.cashAndEquivalents,
      cashAndEquivalentsUSD: convertToUSD(balanceSheetData.cashAndEquivalents),
      formattedCashAndEquivalents: `${formatNumberWithCommas(balanceSheetData.cashAndEquivalents)} ${reportingCurrency}`,
      formattedCashAndEquivalentsUSD: `$${formatNumberWithCommas(convertToUSD(balanceSheetData.cashAndEquivalents))}`,
      totalDebt: balanceSheetData.totalDebt,
      totalDebtUSD: convertToUSD(balanceSheetData.totalDebt),
      formattedTotalDebt: `${formatNumberWithCommas(balanceSheetData.totalDebt)} ${reportingCurrency}`,
      formattedTotalDebtUSD: `$${formatNumberWithCommas(convertToUSD(balanceSheetData.totalDebt))}`,
      sharesOutstanding: sharesOutstandingData.value,
      formattedSharesOutstanding: sharesOutstandingData.formattedValue,
      sourceUrls: {
        overview: currentPriceData.sourceUrl,
        financials: sharesOutstandingData.sourceUrl,
        cashFlow: freeCashFlowData.sourceUrl,
        balanceSheet: balanceSheetData.sourceUrl
      }
    };
    
    res.json({
      success: true,
      data: stockData
    });
  } catch (error) {
    handleError(error, res, ticker);
  }
});

module.exports = router;