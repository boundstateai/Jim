import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { jimMathPack } from './packs/jimMath';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App pack={jimMathPack} /></React.StrictMode>
);
