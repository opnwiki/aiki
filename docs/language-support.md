# AIKI interface languages

The header language picker changes the interface immediately and saves the choice in the `aiki-locale` cookie for one year. The cookie is readable during server rendering, so navigation and a page reload preserve the selected language. Country flag PNGs are loaded from `https://flagcdn.com/w160/<country-code>.png`.

Supported interface locales:

- English (`en`, United States flag)
- Русский (`ru`, Russia)
- 中文 (`zh`, China)
- Español (`es`, Spain)
- 日本語 (`ja`, Japan)
- Deutsch (`de`, Germany)
- Français (`fr`, France)
- العربية (`ar`, Saudi Arabia; right-to-left document direction)

Translations apply to the shared navigation/footer, home page, topic list, topic detail and reply forms, sign-in/register form, and topic composer. New topic and reply submissions record the selected interface locale as their content locale. Comments stay in the language they were written in. A published topic requested in another supported language is machine-translated from its current source revision. An accepted edit of that translation is kept when a later source revision is translated again, as long as the edited passage is still present.
