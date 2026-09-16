export interface PromotionalBanner {
  id: string;
  title: string;
  description?: string;
  image_url: string; // Cloudflare R2 URL
  action_link?: string;
  action_label?: string;
  module: string;
  priority: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
