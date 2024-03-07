// time-utils
export const minutes = (number: number): number => number * 60;
export const hours = (number: number): number => minutes(number) * 60;
export const days = (number: number): number => hours(number) * 24;
