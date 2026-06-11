// test_scroll_sdl.c — Native SDL2 scrolling test for jitter comparison
// Build: gcc -O2 -o test_scroll_sdl test_scroll_sdl.c -lSDL2
// Run:   ./test_scroll_sdl [vsync]     (vsync=1 enables vsync, default=1)
//        ./test_scroll_sdl 0           (no vsync)
//        ./test_scroll_sdl 2           (test both, press V to toggle)
//
// Same test as test_scrolling_rect: colored rectangles scroll via camera,
// reference grid stays fixed in screen space.

#include <SDL2/SDL.h>
#include <stdio.h>
#include <math.h>

#define WIN_W 640
#define WIN_H 480
#define SCALE 2
#define GRID_STEP 20
#define SCROLL_SPEED 1.5
#define CAM_MIN_X 320.0f
#define CAM_MAX_X 704.0f
#define CAM_Y 240.0f
#define BG_W 1200
#define BG_H 480

static void draw_grid(SDL_Surface *surf) {
    Uint32 grid_color = SDL_MapRGB(surf->format, 200, 200, 200);
    // Horizontal lines
    for (int y = 0; y <= WIN_H; y += GRID_STEP) {
        for (int x = 0; x < WIN_W; x++) {
            ((Uint32 *)surf->pixels)[y * surf->pitch / 4 + x] = grid_color;
        }
    }
    // Vertical lines
    for (int x = 0; x <= WIN_W; x += GRID_STEP) {
        for (int y = 0; y < WIN_H; y++) {
            ((Uint32 *)surf->pixels)[y * surf->pitch / 4 + x] = grid_color;
        }
    }
}

static void draw_rect(SDL_Surface *surf, int rx, int ry, int rw, int rh, Uint32 color) {
    // Clip to screen
    int x0 = rx < 0 ? 0 : rx;
    int y0 = ry < 0 ? 0 : ry;
    int x1 = (rx + rw) > WIN_W ? WIN_W : (rx + rw);
    int y1 = (ry + rh) > WIN_H ? WIN_H : (ry + rh);
    for (int y = y0; y < y1; y++) {
        for (int x = x0; x < x1; x++) {
            ((Uint32 *)surf->pixels)[y * surf->pitch / 4 + x] = color;
        }
    }
}

int main(int argc, char *argv[]) {
    int use_vsync = 1;
    if (argc > 1) use_vsync = atoi(argv[1]);

    if (SDL_Init(SDL_INIT_VIDEO) < 0) {
        fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }

    Uint32 flags = SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE;
    SDL_Window *win = SDL_CreateWindow("SDL2 Scroll Test (V=toggle vsync, ESC=quit)",
                                        SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                                        WIN_W * SCALE, WIN_H * SCALE, flags);

    Uint32 render_flags = SDL_RENDERER_SOFTWARE;
    if (use_vsync) render_flags |= SDL_RENDERER_PRESENTVSYNC;
    SDL_Renderer *ren = SDL_CreateRenderer(win, -1, render_flags);
    if (!ren) {
        fprintf(stderr, "SDL_CreateRenderer: %s\n", SDL_GetError());
        return 1;
    }

    // Check if vsync actually enabled
    SDL_RendererInfo info;
    SDL_GetRendererInfo(ren, &info);
    int vsync_active = (info.flags & SDL_RENDERER_PRESENTVSYNC) != 0;
    printf("Renderer: %s  vsync=%s\n", info.name, vsync_active ? "ON" : "OFF");

    // Off-screen surface at design resolution
    SDL_Surface *canvas = SDL_CreateRGBSurface(0, WIN_W, WIN_H, 32, 0, 0, 0, 0);
    SDL_Texture *tex = SDL_CreateTexture(ren, SDL_PIXELFORMAT_RGB888,
                                          SDL_TEXTUREACCESS_STREAMING, WIN_W, WIN_H);

    Uint32 white      = SDL_MapRGB(canvas->format, 255, 255, 255);
    Uint32 pink       = SDL_MapRGB(canvas->format, 204, 136, 136);
    Uint32 blue       = SDL_MapRGB(canvas->format, 136, 136, 204);
    Uint32 bg_color   = white;

    float cam_x = CAM_MIN_X;
    float cam_y = CAM_Y;
    int direction = 1;
    int running = 1;
    int frame_count = 0;

    Uint64 freq = SDL_GetPerformanceFrequency();
    Uint64 last_time = SDL_GetPerformanceCounter();
    double fps_accum = 0;
    int fps_frames = 0;
    double display_fps = 0;
    double display_ft = 0;

    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            if (e.type == SDL_QUIT) running = 0;
            if (e.type == SDL_KEYDOWN) {
                if (e.key.keysym.sym == SDLK_ESCAPE) running = 0;
                if (e.key.keysym.sym == SDLK_v) {
                    // Toggle vsync
                    use_vsync = !use_vsync;
                    SDL_DestroyRenderer(ren);
                    render_flags = SDL_RENDERER_SOFTWARE;
                    if (use_vsync) render_flags |= SDL_RENDERER_PRESENTVSYNC;
                    ren = SDL_CreateRenderer(win, -1, render_flags);
                    SDL_GetRendererInfo(ren, &info);
                    vsync_active = (info.flags & SDL_RENDERER_PRESENTVSYNC) != 0;
                    printf("VSync toggled: %s\n", vsync_active ? "ON" : "OFF");
                }
            }
        }

        // Timing
        Uint64 now = SDL_GetPerformanceCounter();
        double dt_ms = (double)(now - last_time) * 1000.0 / (double)freq;
        last_time = now;

        // FPS counter
        fps_accum += dt_ms;
        fps_frames++;
        display_ft = dt_ms;
        if (fps_accum >= 1000.0) {
            display_fps = fps_frames * 1000.0 / fps_accum;
            fps_frames = 0;
            fps_accum = 0;
        }

        // Move camera (fixed speed per frame, same as ku test)
        cam_x += SCROLL_SPEED * direction;
        if (cam_x >= CAM_MAX_X) { cam_x = CAM_MAX_X; direction = -1; }
        if (cam_x <= CAM_MIN_X) { cam_x = CAM_MIN_X; direction = 1; }

        // Lock canvas
        SDL_LockSurface(canvas);
        Uint32 *px = (Uint32 *)canvas->pixels;
        int pitch = canvas->pitch / 4;

        // Clear to white
        for (int i = 0; i < WIN_W * WIN_H; i++) px[i] = bg_color;

        // World-space objects (offset by camera)
        int cam_ix = (int)floorf(cam_x);
        int cam_iy = (int)floorf(cam_y);
        int screen_cx = WIN_W / 2;
        int screen_cy = WIN_H / 2;
        int off_x = screen_cx - cam_ix;
        int off_y = screen_cy - cam_iy;

        // BG (world space, large)
        int bg_sx = (BG_W / 2) + off_x;
        int bg_sy = (BG_H / 2) + off_y;
        draw_rect(canvas, bg_sx - BG_W / 2, bg_sy - BG_H / 2, BG_W, BG_H, white);

        // Rect1 (world 100,100 size 200x200)
        int r1x = 100 + off_x - 100; // center-based: x - w/2 + offset
        int r1y = 100 + off_y - 100;
        draw_rect(canvas, r1x, r1y, 200, 200, pink);

        // Rect2 (world 400,300 size 200x200)
        int r2x = 400 + off_x - 100;
        int r2y = 300 + off_y - 100;
        draw_rect(canvas, r2x, r2y, 200, 200, blue);

        // Screen-space grid (reference, does not move)
        draw_grid(canvas);

        SDL_UnlockSurface(canvas);

        // Upload to texture and present
        SDL_UpdateTexture(tex, NULL, canvas->pixels, canvas->pitch);
        SDL_RenderClear(ren);
        SDL_RenderCopy(ren, tex, NULL, NULL);
        SDL_RenderPresent(ren);

        frame_count++;
    }

    SDL_FreeSurface(canvas);
    SDL_DestroyTexture(tex);
    SDL_DestroyRenderer(ren);
    SDL_DestroyWindow(win);
    SDL_Quit();
    return 0;
}
