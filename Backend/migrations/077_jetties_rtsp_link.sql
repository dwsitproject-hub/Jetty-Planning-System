-- Optional RTSP URL per jetty for Jetty Live CCTV (schematic + /jetty-live).

ALTER TABLE public.jetties
  ADD COLUMN IF NOT EXISTS rtsp_link TEXT;
