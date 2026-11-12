# Отдельные творческие вставки

12 ноября 2026 года.

По дополнительным референсам добавлены четыре оригинальные иллюстрации: сухоцветы на бумаге, бабочка с папоротником, луна на рваной бумаге и декоративная зелёная марка. Это самостоятельные вставки между разделами, среди книг и в конце коллекций. Внутри них нет людей, аватаров, действий, цитат и других данных участников. Существующие рисунки людей сохранены отдельно.

## Файлы и происхождение

- `src/assets/illustrations/scrapbook-atlas.webp` — один прозрачный атлас 1254 × 1254 px, четыре равные ячейки; изображения загружаются с сайта приложения и кэшируются одним файлом.
- `src/ui/CreativeInsert.tsx` — независимый от иллюстраций людей компонент.
- `src/creative-inserts.css` — композиции, размеры и адаптация к тёмной теме.

Иллюстрации созданы встроенным imagegen по пользовательским photo_25, photo_29, photo_27 и photo_22 от 11 ноября. Референсы использованы для настроения и техники, их надписи и точные композиции не копировались. Оригинальный PNG сохранён в рабочем архиве проекта. Для сайта файл перекодирован в WebP без потерь: проверено полное совпадение RGBA каждого пикселя и прозрачности, без изменения размеров или изображения.

## Итоговый промпт

Use case: illustration-story. Asset type: ONE square 2-by-2 transparent atlas of four separate original vintage scrapbook stickers for a warm literary mobile app.
Input images 1-4 are mood/style references only: botanical cutouts, lunar paper collage, forest-green fern postage stamp, and layered cream paper with pressed flowers. Do not copy any text or exact reference composition.
Top left quarter: a small delicate arrangement of pressed cream daisies and dusty pink wildflowers with slender sage-green leaves, attached to a small torn warm cream printed-paper scrap using a short strip of translucent beige tape. The paper is secondary and the flowers are clearly visible. Fine natural botanical detail, muted color, vintage illustration.
Top right quarter: a single delicate cream-and-dusty-rose butterfly with finely drawn dark wing veins, next to one small curved sage-green fern sprig. They form one balanced cutout cluster; no other objects.
Bottom left quarter: an antique-style full moon with finely engraved craters in warm grey, placed partly over two small overlapping pieces of fibrous torn beige paper. A modest astronomical keepsake, not a night sky photo.
Bottom right quarter: one small dark forest-green rectangular decorative postage stamp with cream scalloped/perforated paper border. Inside it, an elegant pale-gold fern branch and a tiny crescent moon with three tiny stars. Fine ink engraving, worn paper texture. No real country, denomination, letters or numbers.
All four stickers should feel like carefully cut pieces from a beautiful old reader's scrapbook. Fine paper fibers, subtle natural watercolor and engraved detail, cream/sage/dusty rose/forest green palette, matte. No glossy effects, no modern cartoon outline. Every complete sticker must be centered in its own equally sized quarter with at least 9 percent transparent margin on ALL sides of EACH quarter. No overlaps between quarters, no cutting off petals, wings or stamp edges. TRUE TRANSPARENT ALPHA background, no white background, no checkerboard, no grid or cell borders, no surrounding rectangular sheet, no cast shadow outside the sticker. No readable text, handwriting, logos, signatures, watermarks.

## Размещение и доступность

Лунная вставка завершает главную после информации о чтении и встрече. В клубном каталоге есть вставка после первых шести книг, если список длиннее. Ботанические композиции завершают личную коллекцию и список встреч, бабочки — списки цитат, марка — настройки профиля. В пустые списки книг и публикаций лишние вставки не добавляются.

Размеры зарезервированы до загрузки картинки; вставки не принимают нажатия и скрыты от скринридеров. Иллюстрации имеют пустой alt и отложенную загрузку. Состав каталога, личные данные, права доступа и уведомления не меняются. Новых серверных функций или SQL-миграций не требуется.
