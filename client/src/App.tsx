import React, { useState, useEffect } from 'react';
import './App.css';

// Define TypeScript interfaces for our data structures
interface StockData {
  companyName: string;
  ticker: string;
  reportingCurrency: string;
  exchangeRate: number;
  currentPrice: number;
  formattedCurrentPrice: string;
  freeCashFlow: number;
  freeCashFlowUSD: number;
  formattedFreeCashFlow: string;
  formattedFreeCashFlowUSD: string;
  cashAndEquivalents: number;
  cashAndEquivalentsUSD: number;
  formattedCashAndEquivalents: string;
  formattedCashAndEquivalentsUSD: string;
  totalDebt: number;
  totalDebtUSD: number;
  formattedTotalDebt: string;
  formattedTotalDebtUSD: string;
  sharesOutstanding: number;
  formattedSharesOutstanding: string;
  sourceUrls: {
    overview: string;
    financials: string;
    cashFlow: string;
    balanceSheet: string;
  };
}

interface DCFInputs {
  growthRate1to5: number;
  perpetualGrowthRate: number;
  discountRate: number;
  marginOfSafety: number;
}

interface DCFResults {
  fairValue: number;
  safetyMarginValue: number;
  enterpriseValue: number;
  equityValue: number;
  yearlyProjections: number[];
  isPotentialBuy: boolean;
  originalCurrency: string;
  fairValueInOriginalCurrency: number;
  exchangeRate: number;
}

// Helper function to format large numbers to B/M format
const formatLargeNumber = (number: number | undefined | null) => {
  if (number === undefined || number === null) return 'N/A';
  const absNumber = Math.abs(number);
  if (absNumber >= 1e9) {
    return `$${(number / 1e9).toFixed(2)}B`;
  } else {
    // For values less than a billion, show in millions
    return `$${number.toFixed(2)}M`;
  }
};

const App: React.FC = () => {
  // State for stock ticker and data
  const [ticker, setTicker] = useState<string>('');
  const [stockData, setStockData] = useState<StockData | null>(null);
  // State to track if stock data is being edited
  const [isEditing, setIsEditing] = useState<boolean>(false);
  
  // State for DCF inputs with default values
  const [dcfInputs, setDcfInputs] = useState<DCFInputs>({
    growthRate1to5: 10,
    perpetualGrowthRate: 2.5,
    discountRate: 10,
    marginOfSafety: 25
  });
  
  // State for calculation results
  const [results, setResults] = useState<DCFResults | null>(null);
  
  // Loading and error states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Function to fetch stock data from our API
  const fetchStockData = async () => {
    if (!ticker) {
      setError('Please enter a stock ticker');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/stock/${ticker}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to fetch stock data');
      }
      
      setStockData(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setStockData(null);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Add debounced calculation effect
  useEffect(() => {
    if (stockData) {
      calculateDCF();
    }
  }, [dcfInputs, stockData]); // Recalculate when inputs or stock data change
  
  // Update handleInputChange to handle both text and range inputs
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    if (name === 'ticker') {
      setTicker(value.toUpperCase());
    } else {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        setDcfInputs(prev => ({
          ...prev,
          [name]: numValue
        }));
      }
    }
  };
  
  // Function to calculate DCF valuation
  const calculateDCF = () => {
    if (!stockData) {
      setError('Please fetch stock data first');
      return;
    }
    
    try {
      // Extract values from stockData and dcfInputs
      const { 
        freeCashFlow, 
        cashAndEquivalents, 
        totalDebt, 
        sharesOutstanding,
        exchangeRate,
        reportingCurrency 
      } = stockData;
      const { growthRate1to5, perpetualGrowthRate, discountRate, marginOfSafety } = dcfInputs;
      
      // Convert percentage inputs to decimals
      const growthRateDecimal = growthRate1to5 / 100;
      const perpetualGrowthRateDecimal = perpetualGrowthRate / 100;
      const discountRateDecimal = discountRate / 100;
      const marginOfSafetyDecimal = marginOfSafety / 100;
      
      // Project cash flows for 5 years (in original currency)
      const yearlyProjections: number[] = [];
      let currentFCF = freeCashFlow;
      
      for (let year = 1; year <= 5; year++) {
        currentFCF = currentFCF * (1 + growthRateDecimal);
        yearlyProjections.push(currentFCF);
      }
      
      // Calculate terminal value using perpetual growth model (in original currency)
      const terminalValue = yearlyProjections[4] * (1 + perpetualGrowthRateDecimal) / 
                           (discountRateDecimal - perpetualGrowthRateDecimal);
      
      // Discount all future cash flows to present value (in original currency)
      let presentValue = 0;
      for (let year = 0; year < 5; year++) {
        presentValue += yearlyProjections[year] / Math.pow(1 + discountRateDecimal, year + 1);
      }
      
      // Discount terminal value to present value (in original currency)
      const presentTerminalValue = terminalValue / Math.pow(1 + discountRateDecimal, 5);
      
      // Calculate enterprise value (in original currency)
      const enterpriseValue = presentValue + presentTerminalValue;
      
      // Calculate equity value by adjusting for cash and debt (in original currency)
      const equityValue = enterpriseValue + cashAndEquivalents - totalDebt;
      
      // Calculate fair value per share (convert to USD)
      const fairValueInOriginalCurrency = equityValue / sharesOutstanding;
      const fairValue = fairValueInOriginalCurrency * exchangeRate;
      
      // Apply margin of safety (in USD)
      const safetyMarginValue = fairValue * (1 - marginOfSafetyDecimal);
      
      // Determine if the stock is potentially a buy (compare with current price in USD)
      const isPotentialBuy = stockData.currentPrice < safetyMarginValue;
      
      // Set results
      setResults({
        fairValue,
        safetyMarginValue,
        enterpriseValue,
        equityValue,
        yearlyProjections,
        isPotentialBuy,
        originalCurrency: reportingCurrency,
        fairValueInOriginalCurrency,
        exchangeRate
      });
      
      setError(null);
    } catch (err) {
      setError('Error calculating DCF valuation. Please check your inputs.');
      setResults(null);
    }
  };
  
  // Function to reset the form
  const resetForm = () => {
    setTicker('');
    setStockData(null);
    setResults(null);
    setError(null);
    setDcfInputs({
      growthRate1to5: 10,
      perpetualGrowthRate: 2.5,
      discountRate: 10,
      marginOfSafety: 25
    });
  };
  
  // Load recent calculations from local storage on component mount
  useEffect(() => {
    const savedCalculations = localStorage.getItem('recentCalculations');
    if (savedCalculations) {
      // We could display recent calculations here if needed
    }
  }, []);
  
  // Save calculation to local storage when results change
  useEffect(() => {
    if (results && stockData) {
      const calculation = {
        ticker,
        companyName: stockData.companyName,
        timestamp: new Date().toISOString(),
        fairValue: results.fairValue,
        currentPrice: stockData.currentPrice
      };
      
      const savedCalculations = JSON.parse(
        localStorage.getItem('recentCalculations') || '[]'
      );
      
      const updatedCalculations = [calculation, ...savedCalculations.slice(0, 4)];
      localStorage.setItem('recentCalculations', JSON.stringify(updatedCalculations));
    }
  }, [results, stockData, ticker]);
  
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-800">DCF Calculator</h1>
          <p className="text-gray-600 mt-2">
            Calculate the intrinsic value of a stock using the Discounted Cash Flow method
          </p>
        </header>
        
        {error && (
          <div className="mb-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        
        <div className="flex flex-col md:flex-row gap-8">
          {/* Left Panel - Input Parameters */}
          <div className="w-full md:w-1/2 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Input Parameters</h2>
            
            {/* Stock Ticker Input */}
            <div className="mb-6">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="ticker">
                Stock Ticker
              </label>
              <div className="flex">
                <input
                  id="ticker"
                  name="ticker"
                  type="text"
                  value={ticker}
                  onChange={handleInputChange}
                  className="shadow appearance-none border rounded-l w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  placeholder="e.g., AAPL"
                />
                <button
                  onClick={fetchStockData}
                  className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r focus:outline-none focus:shadow-outline"
                  disabled={isLoading}
                >
                  {isLoading ? 'Loading...' : 'Fetch Data'}
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-1">Enter the stock symbol to fetch financial data</p>
            </div>

            {/* Stock Data Display */}
            {stockData && (
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-lg font-semibold">Stock Data</h3>
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className="text-sm bg-blue-500 hover:bg-blue-700 text-white px-3 py-1 rounded"
                  >
                    {isEditing ? 'Save' : 'Edit Data'}
                  </button>
                </div>
                <div className="bg-gray-50 p-4 rounded space-y-3">
                  <div className="flex justify-between items-center">
                    <p><span className="font-semibold">Company:</span> {stockData.companyName}</p>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Current Price ($):</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={stockData.currentPrice}
                          onChange={(e) => setStockData({
                            ...stockData,
                            currentPrice: parseFloat(e.target.value) || 0
                          })}
                          className="w-24 px-2 py-1 border rounded"
                        />
                      ) : (
                        <span>{stockData.currentPrice}</span>
                      )}
                    </div>
                    {stockData.sourceUrls?.overview && (
                      <a
                        href={stockData.sourceUrls.overview}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700"
                        title="View source"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Free Cash Flow (M):</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={stockData.freeCashFlow}
                          onChange={(e) => setStockData({
                            ...stockData,
                            freeCashFlow: parseFloat(e.target.value) || 0
                          })}
                          className="w-24 px-2 py-1 border rounded"
                        />
                      ) : (
                        <span>{stockData.freeCashFlow}</span>
                      )}
                    </div>
                    {stockData.sourceUrls?.cashFlow && (
                      <a
                        href={stockData.sourceUrls.cashFlow}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700"
                        title="View source"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Cash & Equivalents (M):</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={stockData.cashAndEquivalents}
                          onChange={(e) => setStockData({
                            ...stockData,
                            cashAndEquivalents: parseFloat(e.target.value) || 0
                          })}
                          className="w-24 px-2 py-1 border rounded"
                        />
                      ) : (
                        <span>{stockData.cashAndEquivalents}</span>
                      )}
                    </div>
                    {stockData.sourceUrls?.balanceSheet && (
                      <a
                        href={stockData.sourceUrls.balanceSheet}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700"
                        title="View source"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Total Debt (M):</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={stockData.totalDebt}
                          onChange={(e) => setStockData({
                            ...stockData,
                            totalDebt: parseFloat(e.target.value) || 0
                          })}
                          className="w-24 px-2 py-1 border rounded"
                        />
                      ) : (
                        <span>{stockData.totalDebt}</span>
                      )}
                    </div>
                    {stockData.sourceUrls?.balanceSheet && (
                      <a
                        href={stockData.sourceUrls.balanceSheet}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700"
                        title="View source"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Shares Outstanding (M):</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={stockData.sharesOutstanding}
                          onChange={(e) => setStockData({
                            ...stockData,
                            sharesOutstanding: parseFloat(e.target.value) || 0
                          })}
                          className="w-24 px-2 py-1 border rounded"
                        />
                      ) : (
                        <span>{stockData.sharesOutstanding}</span>
                      )}
                    </div>
                    {stockData.sourceUrls?.financials && (
                      <a
                        href={stockData.sourceUrls.financials}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700"
                        title="View source"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Growth & Discount Parameters with Sliders and Input Boxes */}
            <div className="space-y-6">
              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Growth Rate Years 1-5 (%)
                  <div className="float-right flex items-center gap-2">
                    <input
                      type="number"
                      name="growthRate1to5"
                      min="-20"
                      max="50"
                      step="0.5"
                      value={dcfInputs.growthRate1to5}
                      onChange={handleInputChange}
                      className="w-16 px-2 py-1 border rounded text-right"
                    />
                    <span>%</span>
                  </div>
                </label>
                <input
                  type="range"
                  name="growthRate1to5"
                  min="-20"
                  max="50"
                  step="0.5"
                  value={dcfInputs.growthRate1to5}
                  onChange={handleInputChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-gray-500 mt-1">Expected annual growth rate for the first 5 years</p>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Perpetual Growth Rate (%)
                  <div className="float-right flex items-center gap-2">
                    <input
                      type="number"
                      name="perpetualGrowthRate"
                      min="0"
                      max="5"
                      step="0.1"
                      value={dcfInputs.perpetualGrowthRate}
                      onChange={handleInputChange}
                      className="w-16 px-2 py-1 border rounded text-right"
                    />
                    <span>%</span>
                  </div>
                </label>
                <input
                  type="range"
                  name="perpetualGrowthRate"
                  min="0"
                  max="5"
                  step="0.1"
                  value={dcfInputs.perpetualGrowthRate}
                  onChange={handleInputChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-gray-500 mt-1">Long-term growth rate after year 5</p>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Discount Rate (WACC) (%)
                  <div className="float-right flex items-center gap-2">
                    <input
                      type="number"
                      name="discountRate"
                      min="5"
                      max="20"
                      step="0.5"
                      value={dcfInputs.discountRate}
                      onChange={handleInputChange}
                      className="w-16 px-2 py-1 border rounded text-right"
                    />
                    <span>%</span>
                  </div>
                </label>
                <input
                  type="range"
                  name="discountRate"
                  min="5"
                  max="20"
                  step="0.5"
                  value={dcfInputs.discountRate}
                  onChange={handleInputChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-gray-500 mt-1">Weighted Average Cost of Capital</p>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Margin of Safety (%)
                  <div className="float-right flex items-center gap-2">
                    <input
                      type="number"
                      name="marginOfSafety"
                      min="0"
                      max="50"
                      step="5"
                      value={dcfInputs.marginOfSafety}
                      onChange={handleInputChange}
                      className="w-16 px-2 py-1 border rounded text-right"
                    />
                    <span>%</span>
                  </div>
                </label>
                <input
                  type="range"
                  name="marginOfSafety"
                  min="0"
                  max="50"
                  step="5"
                  value={dcfInputs.marginOfSafety}
                  onChange={handleInputChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-gray-500 mt-1">Additional discount for conservative valuation</p>
              </div>
            </div>

            <div className="mt-6 flex space-x-4">
              <button
                onClick={resetForm}
                className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                Reset
              </button>
            </div>
          </div>
          
          {/* Right Panel - Results */}
          <div className="w-full md:w-1/2 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Results</h2>
            
            {results ? (
              <div className="space-y-6">
                {/* Currency Information Banner */}
                <div className="bg-blue-50 p-4 rounded-lg mb-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-semibold">Financial Statements Currency:</span>
                      <span className="ml-2">{results.originalCurrency || 'USD'}</span>
                    </div>
                    <div>
                      <span className="font-semibold">Exchange Rate:</span>
                      <span className="ml-2">
                        {results.originalCurrency === 'USD' ? (
                          'Using USD'
                        ) : (
                          `1 ${results.originalCurrency} = $${(results.exchangeRate || 1).toFixed(4)} USD`
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Main Results Cards */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-blue-800">Fair Value Per Share</h3>
                    <p className="text-3xl font-bold text-blue-600">
                      ${(results.fairValue || 0).toFixed(2)} USD
                    </p>
                    {results.originalCurrency !== 'USD' && (
                      <p className="text-sm text-gray-600">
                        {(results.fairValueInOriginalCurrency || 0).toFixed(2)} {results.originalCurrency}
                      </p>
                    )}
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-green-800">With Margin of Safety ({dcfInputs.marginOfSafety}%)</h3>
                    <p className="text-3xl font-bold text-green-600">
                      ${(results.safetyMarginValue || 0).toFixed(2)} USD
                    </p>
                    {results.originalCurrency !== 'USD' && (
                      <p className="text-sm text-gray-600">
                        {((results.safetyMarginValue || 0) / (results.exchangeRate || 1)).toFixed(2)} {results.originalCurrency}
                      </p>
                    )}
                  </div>
                </div>

                {/* Current Price Comparison */}
                <div className="bg-gray-50 p-4 rounded-lg mb-6">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">Current Stock Price:</span>
                    <div className="text-right">
                      <div>${(stockData?.currentPrice || 0).toFixed(2)} USD</div>
                      {results.originalCurrency !== 'USD' && stockData?.currentPrice && (
                        <div className="text-sm text-gray-600">
                          {(stockData.currentPrice / (results.exchangeRate || 1)).toFixed(2)} {results.originalCurrency}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Detailed Calculations */}
                <div className="space-y-2">
                  <div className="flex justify-between py-2">
                    <span>Enterprise Value</span>
                    <div className="text-right">
                      <div>{formatLargeNumber(results.enterpriseValue)} USD</div>
                      {results.originalCurrency !== 'USD' && (
                        <div className="text-sm text-gray-600">
                          {formatLargeNumber(results.enterpriseValue / (results.exchangeRate || 1))} {results.originalCurrency}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span>+ Cash & Equivalents</span>
                    <span>{stockData ? formatLargeNumber(stockData.cashAndEquivalents) : '$0M'}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span>- Total Debt</span>
                    <span>{stockData ? formatLargeNumber(stockData.totalDebt) : '$0M'}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span>= Equity Value</span>
                    <span>{formatLargeNumber(results.equityValue)}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span>÷ Shares Outstanding</span>
                    <span>{stockData ? (stockData.sharesOutstanding).toFixed(2) : '0'}M</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <div className="flex items-center">
                      <span>Margin of Safety</span>
                      <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-800 rounded text-sm">
                        {dcfInputs.marginOfSafety}%
                      </span>
                    </div>
                    <span>-${Math.abs(results.fairValue - results.safetyMarginValue).toFixed(2)}</span>
                  </div>
                </div>

                {/* Projected Cash Flows Table */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">Projected Cash Flows (millions)</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">YEAR</th>
                          <th className="text-right py-2">FCF</th>
                          <th className="text-right py-2">PV OF FCF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.yearlyProjections.map((projection, index) => (
                          <tr key={index} className="border-b">
                            <td className="py-2">{index + 1}</td>
                            <td className="text-right">${projection.toFixed(2)}</td>
                            <td className="text-right">${(projection / Math.pow(1 + dcfInputs.discountRate/100, index + 1)).toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr className="border-b">
                          <td className="py-2">Perpetual</td>
                          <td className="text-right">${(results.yearlyProjections[4] * (1 + dcfInputs.perpetualGrowthRate/100) / (dcfInputs.discountRate/100 - dcfInputs.perpetualGrowthRate/100)).toFixed(2)}</td>
                          <td className="text-right">${((results.yearlyProjections[4] * (1 + dcfInputs.perpetualGrowthRate/100) / (dcfInputs.discountRate/100 - dcfInputs.perpetualGrowthRate/100)) / Math.pow(1 + dcfInputs.discountRate/100, 5)).toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-500">
                <div className="text-center">
                  <span className="text-4xl">📊</span>
                  <p className="mt-2">Enter a stock ticker and calculate to see results</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
