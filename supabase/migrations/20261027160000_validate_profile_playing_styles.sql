alter table public.profiles
  add constraint profiles_playing_style_allowed
  check (
    playing_style is null
    or playing_style in (
      'Possession Game',
      'Quick Counter (QC)',
      'Long Ball Counter (LBC)',
      'Long Ball',
      'Out Wide',
      'Overload'
    )
  );

comment on constraint profiles_playing_style_allowed on public.profiles is
  'Restricts profile playing styles to supported eFootball options; Overload is a community/custom option.';
