import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { uahCalculusPack } from './packs/uahCalculus';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App pack={uahCalculusPack} /></React.StrictMode>
);
