import { PostmypostPublisher } from './postmypost'

/**
 * Instagram-публикация идёт через Postmypost (postmypost.io) — официальный IG API из РФ
 * требует Business+FB Page+App Review, Postmypost берёт это на себя.
 *
 * Вся логика — в generic `PostmypostPublisher` (он же обслуживает VK-стену через Postmypost).
 * Класс оставлен тонкой обёрткой для обратной совместимости и читаемости фабрики.
 */
export class InstagramPublisher extends PostmypostPublisher {}
