/* @refresh reload */
import { render } from 'solid-js/web'
import App from './App.js'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('renderer root element missing')

render(() => <App />, root)
