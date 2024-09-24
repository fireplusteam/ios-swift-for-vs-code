import sys

def get_runtime_warning_html(script_path, error_message, json: list[dict[str, any]]):
    with open(f"{script_path}/html_templates/run_time_warnings_page_template.html", encoding="utf-8") as file:
        content = file.read()
        return content
    return f""" <html> HELLO </html> """