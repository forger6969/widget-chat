# AI Chat Widget

Встраиваемый AI-чат-виджет для любого сайта — **одна строка подключения**.

## Быстрый старт

```html
<script>
  window.AIWidgetConfig = { apiKey: "gsk_ВАШ_GROQ_КЛЮЧ" };
</script>
<script src="https://your-domain.com/widget.js"></script>
```

или через динамический импорт:

```js
window.AIWidgetConfig = { apiKey: "gsk_..." };
import("https://your-domain.com/widget.js");
```

## Получить API ключ

1. Зайдите на [console.groq.com](https://console.groq.com)
2. Создайте бесплатный аккаунт
3. Сгенерируйте API ключ (`gsk_...`)
4. Вставьте в `AIWidgetConfig.apiKey`

## Конфигурация

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `apiKey` | string | `""` | Groq API ключ |
| `model` | string | `"llama-3.1-8b-instant"` | Модель Groq |
| `systemPrompt` | string | `"You are a helpful..."` | Системный промпт |
| `title` | string | `"AI Assistant"` | Заголовок виджета |
| `position` | string | `"bottom-right"` | `"bottom-right"` \| `"bottom-left"` |
| `apiUrl` | string | Groq endpoint | URL API (для смены провайдера) |

## Публичный API

```js
window.AIWidget.open()          // Открыть окно
window.AIWidget.close()         // Закрыть окно
window.AIWidget.logout()        // Выйти из аккаунта
window.AIWidget.getUser()       // Текущий пользователь
window.AIWidget.setConfig({})   // Обновить конфигурацию
```

## Файлы

| Файл | Описание |
|---|---|
| `widget.js` | Основной скрипт (всё включено) |
| `widget.css` | Опциональный файл для хост-страницы |
| `index.html` | Демо-страница |

## Смена AI-провайдера

Виджет использует OpenAI-совместимый API, поэтому легко переключить на другой провайдер:

```js
window.AIWidgetConfig = {
  apiKey: "ВАШ_КЛЮЧ",
  apiUrl: "https://openrouter.ai/api/v1/chat/completions",
  model: "mistralai/mistral-7b-instruct:free",
};
```
