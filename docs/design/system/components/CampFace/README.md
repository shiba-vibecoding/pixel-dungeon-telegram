Лицо героя на «Продолжить» — `.pd-button.primary.big.stacked.with-face`:

```html
<button class="pd-button primary big stacked with-face">
  <span class="pd-camp-face" aria-hidden="true"><i style="--av:0"></i></span>
  <span class="pd-btn-label">Продолжить</span>
  <span class="pd-btn-sub">Воин · ур. 7 · глубина 9</span>
</button>
```

- Подпись — «класс · ур. N · глубина N» (EN «Warrior · lv 7 · depth 9»): «Дуэлянтка, уровень 4 · глубина 6» на 375 px уже не влезает.
- Сетка 44 px | текст, текст по левому краю, обе строки в одну строку с многоточием.
- Портрет 44×44 в выемчатой рамке на тёмно-красном (`--blood-lo`), голова из `avatars.png` (ячейка 48×64, `left: -2px; top: 1px`); облики Дуэлянтки и Клирика — `<i class="skin" style="--av:…">` из `avatars-skins.png`. Нажатие опускает портрет на 1 px вместе с кнопкой.
- Это герой сохранённого забега — и когда в сцене пролистан другой класс для «Новой игры».
- Нет сохранённого забега — кнопки нет (как раньше, «Новая игра» становится основной).
