require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const createError = require('http-errors');
const path = require('path');

// Import routes
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply rate limiting to API routes
app.use('/api', limiter);

// Routes
app.use('/api', apiRoutes);

// Serve static files from React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// 404 handler
app.use((req, res, next) => {
  next(createError(404, 'Route not found'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // Provide more detailed error messages for specific errors
  let errorMessage = err.message || 'Internal Server Error';
  let errorStatus = err.status || 500;
  
  // Check if it's a Yahoo Finance scraping error
  if (errorMessage.includes('Failed to fetch data from https://finance.yahoo.com')) {
    errorMessage = 'Unable to retrieve data from Yahoo Finance. This could be due to temporary service issues or changes in their website structure. Please try again later or check the stock ticker.';
    errorStatus = 503; // Service Unavailable
  }
  
  res.status(errorStatus).json({
    success: false,
    error: {
      message: errorMessage,
      status: errorStatus,
      originalError: err.message
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});